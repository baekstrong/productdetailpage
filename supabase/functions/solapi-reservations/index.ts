import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

type MessageType =
  | 'reservation_received'
  | 'payment 안내'
  | 'seat_opened'
  | 'payment_completed'
  | 'class_reminder'
  | 'review_material';

const templates: Record<MessageType, string> = {
  // 예약 신청 완료 문자
  reservation_received: `케틀벨 원데이 수업 예약 대기가 완료되었습니다

수업 일정: {class_date}
정원: 6명

해당 날짜 모집이 열리면 대기 순서에 따라 결제 안내 문자를 보내드립니다
결제까지 완료되어야 수업 자리가 확정됩니다`,
  // 결제 안내 문자
  'payment 안내': `케틀벨 원데이 수업 결제 안내드립니다

수업 일정: {class_date}
장소: {place}
정원: 6명

아래 링크에서 결제를 완료하시면 자리가 확정됩니다
{payment_url}

안내 문자를 받은 뒤 24시간 이내에 결제해 주세요
시간 내 미결제 시 다음 대기자에게 자리가 넘어갈 수 있습니다`,
  // 여석 안내 문자
  seat_opened: `케틀벨 원데이 수업에 여석이 생겨 안내드립니다

수업 일정: {class_date}
장소: {place}

아래 링크에서 결제를 완료하시면 자리가 확정됩니다
{payment_url}

안내 문자를 받은 뒤 24시간 이내에 결제해 주세요
여석 안내는 순차적으로 발송되며 결제 완료 순으로 확정됩니다`,
  // 결제 완료 문자
  payment_completed: `케틀벨 원데이 수업 결제가 완료되었습니다

수업 일정: {class_date}
장소: {place}

수업 전날 준비물과 장소 안내 문자를 한 번 더 보내드립니다`,
  // 수업 전 리마인드 문자
  class_reminder: `내일 케틀벨 원데이 수업 안내드립니다

수업 일정: {class_date}
장소: {place}
준비물: 편한 복장, 물 또는 텀블러 (신발은 필요 없습니다)

처음 하시는 분 기준으로 천천히 진행합니다`,
  // 수업 후 복습 자료 문자
  review_material: `오늘 케틀벨 원데이 수업 고생하셨습니다

복습용 교재 링크입니다
https://www.notion.so/easystrength/Part-2-9910eb46d55f40efad4f986986f5876d?source=copy_link

오늘 배운 내용을 한 번에 다 하려고 하지 마시고
스윙과 겟업 중 하나만 먼저 복습해보시면 됩니다

복습 영상 링크는 별도로 안내드리겠습니다`,
  // 복습 영상은 백관장 수동 발송
};

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

function maskPhone(phone: string): string {
  return phone.replace(/^(010)(\d{4})(\d{4})$/, '$1-****-$3');
}

// --- 관리자 인증 (문자 발송 엔드포인트 악용/요금 폭탄 방지) ---
async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function assertAdminPassword(password: string): Promise<void> {
  const ADMIN_PASSWORD_HASH = Deno.env.get('ADMIN_PASSWORD_HASH');
  if (!ADMIN_PASSWORD_HASH) throw new Error('ADMIN_PASSWORD_HASH is not configured');
  if (!timingSafeEqual(await sha256Hex(password), ADMIN_PASSWORD_HASH)) throw new Error('invalid password');
}

// --- Solapi 실제 발송 (HMAC-SHA256 서명 인증) ---
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function onlyDigits(value: string): string {
  return String(value || '').replace(/[^0-9]/g, '');
}

async function sendSolapi(to: string, text: string, scheduledAt?: string) {
  const SOLAPI_API_KEY = Deno.env.get('SOLAPI_API_KEY');
  const SOLAPI_API_SECRET = Deno.env.get('SOLAPI_API_SECRET');
  const SOLAPI_SENDER = Deno.env.get('SOLAPI_SENDER');
  // 키가 없으면 안전하게 skip (개발/미설정 환경). 키만 넣으면 아래 실제 발송이 동작한다.
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
    return { ok: false, skipped: true, reason: 'Solapi secrets are not configured', to: maskPhone(to), text };
  }

  const date = new Date().toISOString();
  const salt = randomSalt();
  const signature = await hmacSha256Hex(SOLAPI_API_SECRET, date + salt);
  const authorization = `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;

  const byteLength = new TextEncoder().encode(text).length;
  const message: Record<string, unknown> = {
    to: onlyDigits(to),
    from: onlyDigits(SOLAPI_SENDER),
    text,
    // 한글 템플릿은 SMS(90바이트) 초과 → LMS로 발송. 짧으면 SMS.
    type: byteLength <= 80 ? 'SMS' : 'LMS',
  };
  if (byteLength > 80) message.subject = '케틀벨 원데이 수업';

  const payload: Record<string, unknown> = { message };
  if (scheduledAt) payload.scheduledDate = scheduledAt;

  const response = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: result.errorMessage || result.message || `solapi send failed (${response.status})`, to: maskPhone(to) };
  }
  return {
    ok: true,
    provider: 'solapi',
    to: maskPhone(to),
    messageId: result.messageId || (result.groupInfo && result.groupInfo._id) || null,
    status: result.statusCode || 'sent',
    scheduledAt,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    // 관리자 비밀번호로 보호: 서버사이드(admin-reservations) 호출만 허용, 브라우저/외부 직접 호출 차단.
    await assertAdminPassword(String(body.password || ''));

    const messageType = body.messageType as MessageType;
    const phone = String(body.phone || '');
    const scheduledAt = body.scheduledAt ? String(body.scheduledAt) : undefined;
    const values = body.values || {};

    if (!templates[messageType]) return jsonResponse({ error: 'unknown message type' }, 400);
    if (!phone) return jsonResponse({ error: 'phone is required' }, 400);

    const text = fillTemplate(templates[messageType], values);
    const result = await sendSolapi(phone, text, scheduledAt);
    return jsonResponse({ ...result, messageType, phoneMasked: maskPhone(phone) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message === 'invalid password' ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
