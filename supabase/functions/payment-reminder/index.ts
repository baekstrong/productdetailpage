import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// 운영자 D-7 결제 안내 리마인더 — pg_cron이 매일 1회 내부 호출(Bearer service_role).
// 오늘+7일·미발송·미결제 신청자≥1 수업에 대해 운영자(ADMIN_PHONE)에게 문자 1통 + 발송 이력 기록.

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
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

// 오늘+7일을 KST 기준 YYYY-MM-DD로. 서버는 UTC이므로 +9h 후 날짜 부분을 쓴다.
function targetDateKst(): string {
  const ms = Date.now() + 9 * 3600 * 1000 + 7 * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// "2026-06-30" → "6월 30일(화)". 정오 UTC로 요일 계산(타임존 안전).
function classLabel(dateStr: string): string {
  const p = String(dateStr || '').split('-');
  if (p.length !== 3) return String(dateStr || '');
  const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12));
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return `${Number(p[1])}월 ${Number(p[2])}일(${dow})`;
}

// solapi-reservations 내부 호출(Bearer service_role).
async function sendAdminSms(phone: string, values: Record<string, string>) {
  const { url, serviceKey } = getSupabaseAdmin();
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ messageType: 'admin_payment_reminder', phone, values }),
    });
    return await response.json().catch(() => ({ ok: false, error: 'invalid solapi response' }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'solapi call failed' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  // 인증: 내부 호출(Bearer service_role)만.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = req.headers.get('authorization') || '';
  if (!(serviceKey.length > 0 && timingSafeEqual(authHeader, `Bearer ${serviceKey}`))) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  try {
    const adminPhone = Deno.env.get('ADMIN_PHONE') || '';
    const target = targetDateKst();
    const classes = await supabaseFetch(
      `classes?class_date=eq.${target}&is_public=eq.true&status=neq.hidden&payment_reminder_sent_at=is.null&select=id,class_date`
    );
    const rows = Array.isArray(classes) ? classes : [];
    let sent = 0;
    for (const c of rows) {
      // 미결제 활성 신청자(승인 전 + 결제대상). 취소·노쇼·결제완료 제외.
      // 결제완료는 reservation_status='confirmed' 또는 payment_status='paid' 두 경로 — paid도 제외해야 정확.
      const apps = await supabaseFetch(
        `reservations?class_id=eq.${encodeURIComponent(String(c.id))}&reservation_status=in.(applied,waitlisted,payment_target)&payment_status=neq.paid&select=id`
      );
      const count = Array.isArray(apps) ? apps.length : 0;
      if (count < 1) continue;
      // 운영자 번호 미설정이면 발송·기록 안 함(기능 off — 시크릿 설정 시 동작).
      if (!adminPhone) continue;
      await sendAdminSms(adminPhone, { class_label: classLabel(String(c.class_date)), count: String(count) });
      // 멱등: 발송 시도한 수업은 이력 기록(중복 발송 방지).
      await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(c.id))}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ payment_reminder_sent_at: new Date().toISOString() }),
      });
      sent += 1;
    }
    return jsonResponse({ ok: true, target_date: target, classes_checked: rows.length, reminders_sent: sent });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : 'reminder failed' }, 500);
  }
});
