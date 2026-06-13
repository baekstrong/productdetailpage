import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// 공개 신청 엔드포인트: 검증 → 중복 차단 → service_role insert → 접수 문자(베스트 에포트).
// anon 직접 insert 정책을 대체한다(요금/스팸 방지 게이트를 서버로 일원화).

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

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

// 접수 문자 발송 — messageType은 자리 상황에 따라 reservation_success(정원 내) 또는 reservation_waitlist(만석).
async function sendReceivedSms(reservationId: string, phone: string, classLabel: string, messageType: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  let result: Record<string, unknown> = { ok: false, error: 'send failed' };
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ messageType, phone, values: { class_date: classLabel } }),
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
        status: ok ? 'sent' : (result && result.skipped ? 'skipped' : 'failed'),
        error_message: ok ? null : ((result && (result.error || result.reason)) as string) || null,
        sent_at: new Date().toISOString(),
      }),
    });
  } catch (_) {
    // 로깅 실패는 무시(베스트 에포트)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    const applicantName = String(body.applicant_name || '').trim();
    const phone = String(body.phone || '').replace(/[^0-9]/g, '');
    const experience = String(body.kettlebell_experience || '').slice(0, 100);
    const reason = String(body.reason || '').slice(0, 1000);
    const classId = String(body.class_id || '');
    const consent = Boolean(body.privacy_consent);

    if (!consent) return jsonResponse({ ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' }, 400);
    if (!applicantName || applicantName.length > 50) return jsonResponse({ ok: false, error: '이름을 확인해 주세요.' }, 400);
    if (!/^010\d{8}$/.test(phone)) return jsonResponse({ ok: false, error: '휴대폰 번호를 확인해 주세요. (010으로 시작하는 11자리)' }, 400);
    if (!classId) return jsonResponse({ ok: false, error: '수업이 선택되지 않았습니다.' }, 400);

    // 신청 가능한 수업인지 확인(공개 + 숨김 아님 + 아직 시작 전).
    const classes = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=id,class_date,start_time,end_time,is_public,status,capacity`);
    const classRow = Array.isArray(classes) ? classes[0] : null;
    if (!classRow || classRow.is_public !== true || classRow.status === 'hidden') {
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
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

    // 같은 수업에 활성 신청(취소/불참 제외)이 이미 있으면 중복 차단.
    const dupes = await supabaseFetch(
      `reservations?class_id=eq.${encodeURIComponent(classId)}&phone=eq.${encodeURIComponent(phone)}&reservation_status=not.in.(cancelled,no_show)&select=id`
    );
    if (Array.isArray(dupes) && dupes.length > 0) {
      return jsonResponse({ ok: false, error: '이미 이 수업에 신청되어 있습니다. 결제 안내 문자를 기다려 주세요.' }, 409);
    }

    const created = await supabaseFetch('reservations', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        class_id: classId,
        applicant_name: applicantName,
        phone,
        kettlebell_experience: experience || null,
        reason: reason || null,
      }),
    });
    const reservation = Array.isArray(created) ? created[0] : created;

    // 신청 시점의 자리 상황으로 접수 문자 분기 — 본인 포함 활성 신청 수가 정원 이내면 선착순 성공, 초과면 대기.
    const activeRows = await supabaseFetch(
      `reservations?class_id=eq.${encodeURIComponent(classId)}&reservation_status=not.in.(cancelled,no_show)&select=id`
    );
    const activeCount = Array.isArray(activeRows) ? activeRows.length : 0;
    const capacity = Number(classRow.capacity || 0);
    const messageType = capacity > 0 && activeCount > capacity ? 'reservation_waitlist' : 'reservation_success';

    // 접수 확인 문자(베스트 에포트 — 실패해도 신청 자체는 성공으로 응답).
    const classLabel = formatSchedule(String(classRow.class_date), String(classRow.start_time), String(classRow.end_time));
    if (reservation && reservation.id) await sendReceivedSms(String(reservation.id), phone, classLabel, messageType);

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    // 유니크 인덱스 위반(동시 신청 레이스)은 중복 신청과 같은 한글 안내로 응답.
    if (message.includes('23505') || message.includes('reservations_active_unique')) {
      return jsonResponse({ ok: false, error: '이미 이 수업에 신청되어 있습니다. 결제 안내 문자를 기다려 주세요.' }, 409);
    }
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
