import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// 공개 본인 취소 엔드포인트: 이름+전화+예약ID가 모두 일치하고, 결제 완료 전 상태일 때만 취소한다.
// 예약ID는 lookup-reservation이 본인 확인 후에만 내려주므로, lookup과 같은 신뢰 수준이다.
// 결제 완료(confirmed/paid)·이미 취소·불참 건은 취소 불가(환불은 별도 문의).

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

// submit-reservation과 동일 포맷.
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

// 취소 안내 문자(베스트 에포트 — 실패해도 취소 자체는 성공).
async function sendCancelledSms(reservationId: string, phone: string, classLabel: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  let result: Record<string, unknown> = { ok: false, error: 'send failed' };
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ messageType: 'reservation_cancelled', phone, values: { class_date: classLabel } }),
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
        message_type: 'reservation_cancelled',
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
    const reservationId = String(body.reservation_id || '');

    if (!applicantName) return jsonResponse({ ok: false, error: '이름을 입력해 주세요.' }, 400);
    if (!/^010\d{8}$/.test(phone)) return jsonResponse({ ok: false, error: '휴대폰 번호를 확인해 주세요.' }, 400);
    if (!reservationId) return jsonResponse({ ok: false, error: '취소할 예약을 찾을 수 없습니다.' }, 400);

    // 이름+전화+예약ID 일치 + 결제 완료 전(payment_status != paid, 활성 신청)일 때만 취소.
    // 조건을 WHERE에 모두 넣어, 결제 완료/취소/불참 건은 0건 업데이트로 막는다.
    const updated = await supabaseFetch(
      `reservations?id=eq.${encodeURIComponent(reservationId)}` +
      `&applicant_name=eq.${encodeURIComponent(applicantName)}` +
      `&phone=eq.${encodeURIComponent(phone)}` +
      `&payment_status=not.eq.paid` +
      `&reservation_status=in.(applied,waitlisted,payment_target)` +
      `&select=id,class:classes(class_date,start_time,end_time)`,
      {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({ reservation_status: 'cancelled', updated_at: new Date().toISOString() }),
      }
    );

    const row = Array.isArray(updated) ? updated[0] : null;
    if (!row) {
      return jsonResponse({ ok: false, error: '취소할 수 없는 예약입니다. 이미 결제·취소되었거나 정보가 일치하지 않습니다.' }, 400);
    }

    const c = (row.class || {}) as Record<string, string>;
    const classLabel = formatSchedule(c.class_date, c.start_time, c.end_time);
    await sendCancelledSms(String(row.id), phone, classLabel);

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
