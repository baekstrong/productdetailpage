import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { callRpc, clientIp, internalHeaders, rateLimit, UUID_RE } from '../_shared/guard.ts';

// 공개 신청 엔드포인트: 검증 → 중복 차단 → service_role insert → 접수 문자(베스트 에포트).
// anon 직접 insert 정책을 대체한다(요금/스팸 방지 게이트를 서버로 일원화).

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

// 결제 링크(즉시 결제 전환: 정원 내 신청 접수 문자에 바로 포함된다).
const PAYMENT_LINK = Deno.env.get('PAYMENT_LINK') || 'https://smartstore.naver.com/easystrength101/products/9825334073';

// 같은 수업 재신청 차단 문구.
const SAME_CLASS_MESSAGE = '이미 이 수업에 신청되어 있습니다. 결제 안내 문자를 확인해 주세요.';
// 다른 수업의 '선착순 자리'는 한 번호당 1건만 — 대기 신청은 날짜별로 따로 허용.
const SEAT_DUP_MESSAGE = '이미 신청하신 수업이 있어, 다른 수업의 선착순 자리는 신청할 수 없습니다. 자리가 찬 수업은 대기로 신청하실 수 있어요.';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

function getSupabaseAdmin() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Supabase admin secrets are not configured');
  return { url: url.replace(/\/$/, ''), serviceKey };
}

async function supabaseFetch(path: string, options: RequestInit = {}) {
  const { url, serviceKey } = getSupabaseAdmin();
  const headers = new Headers(options.headers || {});
  headers.set('apikey', serviceKey);
  headers.set('authorization', `Bearer ${serviceKey}`);
  if (!headers.has('content-type') && options.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Supabase request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function maskPhone(phone: string): string {
  return String(phone || '').replace(/^(010)(\d{4})(\d{4})$/, '$1-****-$3');
}

// "2026-06-20" + "10:00" + "13:00" → "26년 6월 20일 10시~1시(3시간)" — admin-reservations와 동일 포맷.
function formatSchedule(dateStr: string, startTime: string, endTime: string): string {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return String(dateStr || '');
  const yy = parts[0].slice(2);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const to12 = (h: number) => { const x = h % 12; return x === 0 ? 12 : x; };
  const label = (t: string) => {
    const h = Number(String(t).slice(0, 2));
    const m = Number(String(t).slice(3, 5));
    return m ? `${to12(h)}시 ${m}분` : `${to12(h)}시`;
  };
  let timeText = label(startTime);
  if (endTime) {
    const startMin = Number(String(startTime).slice(0, 2)) * 60 + Number(String(startTime).slice(3, 5));
    let durMin = (Number(String(endTime).slice(0, 2)) * 60 + Number(String(endTime).slice(3, 5))) - startMin;
    if (durMin < 0) durMin += 24 * 60;
    const dh = Math.floor(durMin / 60);
    const dm = durMin % 60;
    const durText = dm ? `${dh}시간 ${dm}분` : `${dh}시간`;
    timeText = `${label(startTime)}~${label(endTime)}(${durText})`;
  }
  return `${yy}년 ${month}월 ${day}일 ${timeText}`;
}

// 수업 시작 시각(KST)이 이미 지났는지 — 지난 수업 신청 차단.
function isPastClassKst(classDate: string, startTime: string): boolean {
  const hm = String(startTime || '').slice(0, 5);
  const start = new Date(`${classDate}T${hm}:00+09:00`);
  if (isNaN(start.getTime())) throw new Error(`invalid class datetime: ${classDate} ${startTime}`);
  return start.getTime() < Date.now();
}

// 문자 발송 + message_logs 기록 (베스트 에포트). scheduledAt이 있으면 Solapi 예약 발송으로 등록한다.
async function sendSmsAndLog(reservationId: string, phone: string, messageType: string, values: Record<string, string>, scheduledAt?: string) {
  const { url } = getSupabaseAdmin();
  let result: Record<string, unknown> = { ok: false, error: 'send failed' };
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ messageType, phone, values, scheduledAt }),
    });
    result = await response.json().catch(() => ({ ok: false, error: 'invalid solapi response' }));
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : 'solapi call failed' };
  }
  try {
    const ok = Boolean(result && result.ok);
    await supabaseFetch('message_logs', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        reservation_id: reservationId,
        message_type: messageType,
        phone_masked: maskPhone(phone),
        provider_message_id: (result && ((result.groupId as string) || (result.messageId as string))) || null,
        status: ok ? (scheduledAt ? 'scheduled' : 'sent') : (result && result.skipped ? 'skipped' : 'failed'),
        error_message: ok ? null : ((result && (result.error || result.reason)) as string) || null,
        scheduled_at: scheduledAt || null,
        sent_at: new Date().toISOString(),
        body: (result && (result.text as string)) || null,
      }),
    });
  } catch (_) {
    // 로깅 실패는 무시(베스트 에포트)
  }
}


// 다음 일정 오픈 알림 신청. 문자는 보내지 않는다(관리자가 일정을 연 뒤 '오픈 알림 발송'으로 한 번에 안내).
async function handleOpenAlert(body: Record<string, unknown>, ip: string): Promise<Response> {
  const name = String(body.applicant_name || '').trim().slice(0, 50);
  const phone = String(body.phone || '').replace(/[^0-9]/g, '');
  if (!body.privacy_consent) return jsonResponse({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' }, 400);
  if (!/^010\d{8}$/.test(phone)) return jsonResponse({ ok: false, error: '휴대폰 번호를 확인해 주세요. (010으로 시작하는 11자리)' }, 400);
  if (!(await rateLimit(`alert-ip:${ip}`, 5, 3600))) {
    return jsonResponse({ ok: false, error: '짧은 시간에 신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, 429);
  }
  try {
    await supabaseFetch('class_open_alerts', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ applicant_name: name || null, phone }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // 이미 알림 대기 중인 번호면 성공으로 응답(중복 안내 방지).
    if (!(message.includes('23505') || message.includes('class_open_alerts_pending_unique'))) {
      console.error('open_alert failed:', message);
      return jsonResponse({ ok: false, error: '신청 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
  }
  return jsonResponse({ ok: true });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const ip = clientIp(req);

    // 다음 일정 오픈 알림 신청(열린 수업이 없을 때) — 번호만 받아 두고, 관리자가 일정을 열 때 일괄 안내한다.
    if (body.action === 'open_alert') return await handleOpenAlert(body, ip);

    const applicantName = String(body.applicant_name || '').trim();
    const phone = String(body.phone || '').replace(/[^0-9]/g, '');
    const experience = String(body.kettlebell_experience || '').slice(0, 100);
    const reason = String(body.reason || '').slice(0, 1000);
    const classId = String(body.class_id || '');
    const consent = Boolean(body.privacy_consent);

    if (!consent) return jsonResponse({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' }, 400);
    if (!applicantName || applicantName.length > 50) return jsonResponse({ ok: false, error: '이름을 확인해 주세요.' }, 400);
    if (!/^010\d{8}$/.test(phone)) return jsonResponse({ ok: false, error: '휴대폰 번호를 확인해 주세요. (010으로 시작하는 11자리)' }, 400);
    if (!classId || !UUID_RE.test(classId)) return jsonResponse({ ok: false, error: '수업이 선택되지 않았습니다.' }, 400);

    // 남용(문자 폭탄·비용 공격) 방어: IP당 시간당 10건, 번호당 시간당 5건.
    if (!(await rateLimit(`submit-ip:${ip}`, 10, 3600)) || !(await rateLimit(`submit-phone:${phone}`, 5, 3600))) {
      return jsonResponse({ ok: false, error: '짧은 시간에 신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, 429);
    }

    // 예약 거부(차단) 번호 검사 — 관리자가 차단한 번호는 신규 신청을 받지 않는다.
    const blockedRows = await supabaseFetch(`blocked_phones?phone=eq.${encodeURIComponent(phone)}&select=phone`);
    if (Array.isArray(blockedRows) && blockedRows.length > 0) {
      return jsonResponse({ ok: false, error: '현재 이 번호로는 온라인 예약 신청을 받을 수 없습니다. 필요하시면 문자로 문의해 주세요.' }, 403);
    }

    // 신청 가능한 수업인지 확인(공개 + 숨김 아님 + 아직 시작 전).
    const classes = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=id,class_date,start_time,end_time,is_public,status,capacity,open_at`);
    const classRow = Array.isArray(classes) ? classes[0] : null;
    if (!classRow || classRow.is_public !== true || classRow.status === 'hidden') {
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
    // 예약 오픈 일시가 미래면 아직 신청 불가(달력 미리보기 상태).
    if (classRow.open_at && new Date(String(classRow.open_at)).getTime() > Date.now()) {
      return jsonResponse({ ok: false, error: '아직 예약이 시작되지 않은 수업입니다.' }, 400);
    }
    let isPast = false;
    try {
      isPast = isPastClassKst(String(classRow.class_date), String(classRow.start_time));
    } catch (_) {
      // 수업 시각 데이터 이상 — 내부 값 노출 없이 일반 메시지로 차단.
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
    if (isPast) {
      return jsonResponse({ ok: false, error: '이미 종료된 수업입니다.' }, 400);
    }

    // 정원 판정 + 중복 차단 + insert를 DB 함수 하나(수업 행 잠금)로 처리 — 동시 신청으로 정원이 넘치지 않는다.
    // 마감(closed) 수업은 정원이 남아도 대기로만 접수된다.
    const outcome = await callRpc('create_reservation_atomic', {
      p_class_id: classId,
      p_name: applicantName,
      p_phone: phone,
      p_experience: experience,
      p_reason: reason,
    }) as Record<string, unknown> | null;
    if (!outcome || outcome.error) {
      const code = outcome ? String(outcome.error) : '';
      if (code === 'same_class') return jsonResponse({ ok: false, error: SAME_CLASS_MESSAGE }, 409);
      if (code === 'seat_dup') return jsonResponse({ ok: false, error: SEAT_DUP_MESSAGE }, 409);
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
    const willWaitlist = outcome.waitlisted === true;
    const activeCount = Number(outcome.active_count || 0);
    const capacity = Number(outcome.capacity || 0);
    const reservation = { id: String(outcome.id || '') };

    // 접수 확인 문자(베스트 에포트 — 실패해도 신청 자체는 성공으로 응답).
    const classLabel = formatSchedule(String(classRow.class_date), String(classRow.start_time), String(classRow.end_time));
    if (reservation && reservation.id) {
      if (willWaitlist) {
        // 대기 접수 문자 — 신청 시점 순위(= 본인 제외 활성 - 정원 + 1) 포함.
        const waitlistRank = activeCount - capacity + 1;
        const values: Record<string, string> = { class_date: classLabel };
        if (waitlistRank > 0) values.waitlist_rank = String(waitlistRank);
        await sendSmsAndLog(String(reservation.id), phone, 'reservation_waitlist', values);
      } else {
        // 정원 내 접수 문자(결제 링크 포함).
        await sendSmsAndLog(String(reservation.id), phone, 'reservation_success', { class_date: classLabel, payment_url: PAYMENT_LINK });
      }
    }

    return jsonResponse({ ok: true, waitlisted: willWaitlist });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    // 유니크 인덱스 위반(동시 신청 레이스)은 중복 신청과 같은 한글 안내로 응답.
    if (message.includes('23505') || message.includes('reservations_active_unique')) {
      return jsonResponse({ ok: false, error: SAME_CLASS_MESSAGE }, 409);
    }
    // 내부 오류 원문은 로그에만 남기고 고객에게는 일반 안내만 보낸다.
    console.error('submit-reservation failed:', message);
    return jsonResponse({ ok: false, error: '신청 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.' }, 500);
  }
});
