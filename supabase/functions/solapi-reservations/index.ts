import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

type MessageType =
  | 'reservation_received'
  | 'reservation_success'
  | 'reservation_waitlist'
  | 'payment 안내'
  | 'seat_opened'
  | 'seat_secured'
  | 'payment_completed'
  | 'payment_expired'
  | 'class_reminder'
  | 'review_material'
  | 'review_video'
  | 'reservation_cancelled'
  | 'admin_payment_reminder'
  | 'payment_deadline_reminder'
  | 'custom';

const templates: Record<MessageType, string> = {
  // 예약 신청 완료 문자(레거시 — 신규 신청은 reservation_success/reservation_waitlist 사용)
  reservation_received: `케틀벨 원데이 수업 예약 대기가 완료되었습니다

수업 일정: {class_date}
정원: 6명

해당 날짜 모집이 열리면 대기 순서에 따라 결제 안내 문자를 보내드립니다
결제까지 완료되어야 수업 자리가 확정됩니다`,
  // 접수 문자 — 신청 시점에 정원 내인 경우(선착순). 즉시 결제 전환: 결제 링크를 바로 안내한다.
  reservation_success: `케틀벨 원데이 수업 수강 신청이 접수되었습니다

수업 일정: {class_date}
정원: 6명

현재 정원 내 신청입니다
아래 링크에서 결제를 완료하시면 자리가 확정됩니다(결제 완료 순 확정)
{payment_url}

결제는 안내 후 {payment_deadline_hours}시간까지 가능하며, 기한이 지나면 신청이 취소되고 다음 분께 자리가 안내됩니다
수강이 어려우시면 이 문자로 회신 주세요`,
  // 접수 문자 — 신청 시점에 만석인 경우(대기)
  reservation_waitlist: `케틀벨 원데이 수업 수강 대기 신청이 완료되었습니다

수업 일정: {class_date}

현재 정원이 모두 차서 대기 {waitlist_rank}순위로 접수되었습니다
(현재 기준이며, 앞 신청자가 취소하면 순번은 앞당겨집니다)
여석이 생기면 대기 순서대로 결제 안내 문자를 보내드립니다
문자의 링크에서 결제까지 완료해야 자리가 확정됩니다`,
  // 결제 안내 문자
  'payment 안내': `케틀벨 원데이 수업 결제 안내드립니다

결제 완료 순으로 자리가 확정되니 지금 바로 결제해 주세요
{payment_url}

수업 일정: {class_date}
장소: {place}(https://naver.me/xiqDtNuY)
정원: 6명

결제는 안내 후 {payment_deadline_hours}시간까지 가능하며, 늦어지면 다음 대기자에게 자리가 넘어갈 수 있습니다
그러니 잊지 말고 지금 바로 결제해 주세요
수강을 원하지 않으시면 이 문자로 회신 주시면 다음 대기자에게 자리를 안내하겠습니다`,
  // 여석 안내 문자
  seat_opened: `케틀벨 원데이 수업에 여석이 생겨 안내드립니다

수업 일정: {class_date}
장소: {place}(https://naver.me/xiqDtNuY)

수강을 원하시면 아래 링크에서 결제를 완료해 주세요(결제 시 자리 확정)
{payment_url}

안내 문자를 받은 뒤 {payment_deadline_hours}시간 이내에 결제해 주세요
수강을 원하지 않으시면 이 문자로 회신 주시면 대기 명단에서 정리해 드리겠습니다
여석 안내는 순차적으로 발송되며 결제 완료 순으로 확정됩니다`,
  // 결제 전 자리 확보 문자 — 수업이 아직 한참 남아 결제 링크를 주지 않고 자리만 확보 안내(결제 링크는 D-7에 별도 발송)
  seat_secured: `케틀벨 원데이 수업 자리 안내드립니다

앞선 신청자 취소로 여석이 생겨 {class_date} 수업에 자리를 확보해 드렸습니다
장소: {place}(https://naver.me/xiqDtNuY)

결제 링크는 수업 약 1주일 전에 문자로 보내드립니다
문자의 링크에서 결제까지 완료해야 수업 자리가 최종 확정됩니다

지금 따로 하실 일은 없으며 일정에 참고만 해 주세요
수강이 어려우시면 이 문자로 회신 주시면 자리를 정리해 드리겠습니다`,
  // 결제 완료 문자
  payment_completed: `케틀벨 원데이 수업 결제가 완료되었습니다

수업 일정: {class_date}
장소: {place}(https://naver.me/xiqDtNuY)

수업 전날 준비물과 장소 안내 문자를 한 번 더 보내드립니다`,
  // 미결제 마감(기한 만료) 안내 문자
  payment_expired: `케틀벨 원데이 수업 예약 안내드립니다

수업 일정: {class_date}
장소: {place}(https://naver.me/xiqDtNuY)

안내드린 시간 내 결제가 확인되지 않아 이번 예약은 취소되었습니다
자리는 다음 대기자에게 안내됩니다

다시 수강을 원하시면 예약 페이지에서 대기 신청해 주세요`,
  // 수업 전 리마인드 문자
  class_reminder: `내일 케틀벨 원데이 수업 안내드립니다

수업 일정: {class_date}
장소: {place}(https://naver.me/xiqDtNuY)
준비물: 편한 복장, 물 또는 텀블러 (신발은 필요 없습니다)

별도 주차 공간이 없으니 대중교통을 이용해 주시기 바랍니다`,
  // 수업 후 복습 자료 문자
  review_material: `오늘 케틀벨 원데이 수업 고생하셨습니다

복습용 교재 링크입니다
https://www.notion.so/easystrength/Part-2-9910eb46d55f40efad4f986986f5876d?source=copy_link

복습 영상 링크는 별도로 안내드리겠습니다`,
  // 복습 영상 안내 문자 — 관리자가 영상 링크를 입력해 발송
  review_video: `케틀벨 원데이 수업 복습 영상입니다

{video_url}

수업에서 다룬 동작을 영상으로 다시 확인해 보세요
고생하셨습니다!`,
  // 예약 취소 안내 문자
  reservation_cancelled: `케틀벨 원데이 수업 예약이 취소 처리되었습니다

수업 일정: {class_date}

다시 수강을 원하시면 예약 페이지에서 신청해 주세요
좋은 일정으로 다시 만나 뵙겠습니다`,
  // 운영자(백관장)용 D-7 결제 안내 리마인더
  admin_payment_reminder: `[케틀벨 원데이 리마인더]
{class_label} 수업이 7일 앞입니다.
현재 신청 {count}명 — 선착순 승인하고 결제 안내를 보내주세요.`,
  // 결제 기한 임박 리마인드 — 결제 안내 발송 시 기한의 절반 시점으로 예약 발송된다(결제/취소 시 자동 취소).
  payment_deadline_reminder: `케틀벨 원데이 수업 결제 리마인드입니다

결제 기한이 약 {remaining_hours}시간 남았습니다
기한이 지나면 신청이 취소되고 다음 분께 자리가 안내됩니다

{payment_url}

수업 일정: {class_date}

이미 결제하셨다면 이 문자는 무시해 주세요
수강이 어려우시면 이 문자로 회신 주세요`,
  // 직접 작성 문자 — 템플릿 없이 관리자가 쓴 본문(overrideText)을 그대로 발송한다.
  custom: '',
};

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

// --- 관리자 수정 템플릿 저장소 (public.message_templates, service_role로만 접근) ---
// 행이 있으면 코드 기본 템플릿 대신 그 body를 쓰고, 행 삭제 = 기본값 복원.
function templateStore(): { url: string; key: string } | null {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

// 저장된 수정본 조회(type 지정 시 그 종류만). 실패하면 빈 맵 — 기본 템플릿으로 안전 폴백해 발송은 계속된다.
async function fetchTemplateOverrides(messageType?: string): Promise<Record<string, string>> {
  const store = templateStore();
  if (!store) return {};
  const filter = messageType ? `&message_type=eq.${encodeURIComponent(messageType)}` : '';
  try {
    const res = await fetch(`${store.url}/rest/v1/message_templates?select=message_type,body${filter}`, {
      headers: { apikey: store.key, authorization: `Bearer ${store.key}` },
    });
    if (!res.ok) return {};
    const rows = await res.json();
    const map: Record<string, string> = {};
    if (Array.isArray(rows)) for (const r of rows) if (r && r.body) map[String(r.message_type)] = String(r.body);
    return map;
  } catch (_) {
    return {};
  }
}

// 운영 설정 조회(app_settings). 실패하면 null — 호출부에서 기본값으로 폴백.
async function fetchAppSetting(key: string): Promise<string | null> {
  const store = templateStore();
  if (!store) return null;
  try {
    const res = await fetch(`${store.url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: store.key, authorization: `Bearer ${store.key}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] && rows[0].value ? String(rows[0].value) : null;
  } catch (_) {
    return null;
  }
}

async function saveTemplateOverride(messageType: string, body: string): Promise<void> {
  const store = templateStore();
  if (!store) throw new Error('Supabase secrets are not configured');
  const headers = { apikey: store.key, authorization: `Bearer ${store.key}`, 'content-type': 'application/json' };
  if (!body.trim()) {
    // 빈 본문 저장 = 수정본 삭제 = 기본 템플릿 복원
    const res = await fetch(`${store.url}/rest/v1/message_templates?message_type=eq.${encodeURIComponent(messageType)}`, { method: 'DELETE', headers });
    if (!res.ok) throw new Error(`template delete failed (${res.status})`);
    return;
  }
  const res = await fetch(`${store.url}/rest/v1/message_templates?on_conflict=message_type`, {
    method: 'POST',
    headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ message_type: messageType, body, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`template save failed (${res.status})`);
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

async function buildAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = randomSalt();
  const signature = await hmacSha256Hex(apiSecret, date + salt);
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
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

  const authorization = await buildAuthHeader(SOLAPI_API_KEY, SOLAPI_API_SECRET);

  const byteLength = new TextEncoder().encode(text).length;
  const message: Record<string, unknown> = {
    to: onlyDigits(to),
    from: onlyDigits(SOLAPI_SENDER),
    text,
    // 한글 템플릿은 SMS(90바이트) 초과 → LMS로 발송. 짧으면 SMS.
    type: byteLength <= 80 ? 'SMS' : 'LMS',
  };
  if (byteLength > 80) message.subject = '케틀벨 원데이 수업';

  // 예약 발송(scheduledDate)은 단건 /send가 아니라 /send-many/detail 에서만 지원된다.
  // messages는 배열, scheduledDate는 최상위(ISO8601, +09:00 KST)로 전달한다.
  const payload: Record<string, unknown> = { messages: [message], allowDuplicates: true };
  if (scheduledAt) payload.scheduledDate = scheduledAt;

  const response = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: result.errorMessage || result.message || `solapi send failed (${response.status})`, to: maskPhone(to) };
  }
  // send-many/detail은 일부 실패해도 HTTP 200 — failedMessageList로 건별 실패를 판정한다.
  const failed = Array.isArray(result.failedMessageList) ? result.failedMessageList : [];
  if (failed.length > 0) {
    const f = failed[0];
    return { ok: false, error: f.statusMessage || f.statusCode || 'solapi send failed', to: maskPhone(to) };
  }
  const groupId = (result.groupInfo && result.groupInfo.groupId) || null;
  const messageId = (Array.isArray(result.messageList) && result.messageList[0] && result.messageList[0].messageId) || null;
  return {
    ok: true,
    provider: 'solapi',
    to: maskPhone(to),
    messageId,
    groupId,
    status: (result.groupInfo && result.groupInfo.status) || 'sent',
    scheduledAt,
  };
}

// 예약 발송 취소: 그룹 단위 예약을 DELETE 한다.
async function cancelSchedule(groupId: string) {
  const SOLAPI_API_KEY = Deno.env.get('SOLAPI_API_KEY');
  const SOLAPI_API_SECRET = Deno.env.get('SOLAPI_API_SECRET');
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET) {
    return { ok: false, skipped: true, reason: 'Solapi secrets are not configured' };
  }
  const authorization = await buildAuthHeader(SOLAPI_API_KEY, SOLAPI_API_SECRET);
  const response = await fetch(`https://api.solapi.com/messages/v4/groups/${encodeURIComponent(groupId)}/schedule`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: result.errorMessage || result.message || `cancel failed (${response.status})`, groupId };
  }
  return { ok: true, cancelled: true, groupId };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    // 인증: ① 서버사이드 내부 호출(Bearer service_role key) 또는 ② 관리자 비밀번호.
    // service_role key는 서버(Edge Function) 환경에서만 알 수 있으므로 내부 호출 증명이 된다.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authHeader = req.headers.get('authorization') || '';
    const isInternalCall = serviceKey.length > 0 && timingSafeEqual(authHeader, `Bearer ${serviceKey}`);
    if (!isInternalCall) await assertAdminPassword(String(body.password || ''));

    // 예약 발송 취소 요청(서버사이드 admin-reservations에서 호출).
    if (body.cancelGroupId) {
      const result = await cancelSchedule(String(body.cancelGroupId));
      return jsonResponse(result);
    }

    // 문자 템플릿 조회/수정 — 관리자 화면 '문자 템플릿 수정' 모달용.
    if (body.listTemplates) {
      const overrides = await fetchTemplateOverrides();
      const list = (Object.keys(templates) as MessageType[])
        .filter((type) => type !== 'custom') // custom은 템플릿 없는 자유 문자라 편집 대상 아님
        .map((type) => ({
          message_type: type,
          body: overrides[type] || templates[type],
          default_body: templates[type],
          is_custom: Boolean(overrides[type]),
        }));
      return jsonResponse({ ok: true, templates: list });
    }
    if (body.saveTemplate) {
      const type = String(body.messageType || '') as MessageType;
      if (templates[type] === undefined || type === 'custom') return jsonResponse({ error: 'unknown message type' }, 400);
      const templateBody = String(body.templateBody || '');
      await saveTemplateOverride(type, templateBody);
      return jsonResponse({ ok: true, messageType: type, restored: !templateBody.trim() });
    }

    const messageType = body.messageType as MessageType;
    const phone = String(body.phone || '');
    const scheduledAt = body.scheduledAt ? String(body.scheduledAt) : undefined;
    const values = body.values || {};

    if (templates[messageType] === undefined) return jsonResponse({ error: 'unknown message type' }, 400);

    // 관리자가 발송 전 확인 화면에서 수정한 본문(overrideText)이 있으면 템플릿 대신 그대로 발송한다.
    const overrideText = typeof body.overrideText === 'string' && body.overrideText.trim() ? String(body.overrideText) : '';
    // 관리자가 저장해 둔 수정 템플릿이 있으면 그걸, 없으면 코드 기본 템플릿을 쓴다.
    const stored = await fetchTemplateOverrides(messageType);
    const template = stored[messageType] || templates[messageType];
    // 결제 기한(시간)은 운영 설정에서 채운다 — {payment_deadline_hours} 치환용. 호출부 values가 있으면 우선.
    const deadlineHours = (await fetchAppSetting('payment_deadline_hours')) || '24';
    const text = overrideText || fillTemplate(template, { payment_deadline_hours: deadlineHours, ...values });

    // preview: 발송 없이 채워진 본문만 반환 — 관리자 발송 전 확인/수정용.
    if (body.preview) return jsonResponse({ ok: true, preview: true, messageType, text });

    if (!text.trim()) return jsonResponse({ error: 'text is required' }, 400);
    if (!phone) return jsonResponse({ error: 'phone is required' }, 400);
    const result = await sendSolapi(phone, text, scheduledAt);
    return jsonResponse({ ...result, messageType, phoneMasked: maskPhone(phone) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    const status = message === 'invalid password' ? 401 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
});
