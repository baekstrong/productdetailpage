// 공용 보안 도우미: 요청 횟수 제한(rate_events) + 함수 간 내부 호출 인증.
// 각 함수 폴더에서 `import { ... } from '../_shared/guard.ts'` 로 사용한다.

function adminEnv() {
  const url = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return { url, serviceKey };
}

// 프록시 뒤 실제 클라이언트 IP(첫 번째 x-forwarded-for). 없으면 'unknown'.
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0].trim();
  return first || req.headers.get('cf-connecting-ip') || 'unknown';
}

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { url, serviceKey } = adminEnv();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${name} failed (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 창 안 기록 수가 max 미만이면 true(+기록). DB 장애 시에는 서비스가 멈추지 않도록 통과(true)시킨다.
export async function rateLimit(bucket: string, max: number, windowSeconds: number, record = true): Promise<boolean> {
  try {
    const ok = await rpc('rate_limit_hit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds, p_record: record });
    return ok !== false;
  } catch (_) {
    return true;
  }
}

export async function recordRate(bucket: string): Promise<void> {
  try { await rpc('rate_limit_record', { p_bucket: bucket }); } catch (_) { /* best effort */ }
}

export async function callRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  return await rpc(name, args);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

// 함수 → 함수 호출 헤더. 내부 인증은 INTERNAL_CALL_SECRET(설정 시)을 우선 쓰고,
// 레거시 Bearer service_role도 함께 보낸다(키 전환 전후 모두 동작).
export function internalHeaders(): Record<string, string> {
  const { serviceKey } = adminEnv();
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const secret = Deno.env.get('INTERNAL_CALL_SECRET') || '';
  if (secret) headers['x-internal-secret'] = secret;
  return headers;
}

export function isInternalCall(req: Request): boolean {
  const secret = Deno.env.get('INTERNAL_CALL_SECRET') || '';
  const given = req.headers.get('x-internal-secret') || '';
  if (secret && given && timingSafeEqual(given, secret)) return true;
  const { serviceKey } = adminEnv();
  const authHeader = req.headers.get('authorization') || '';
  return serviceKey.length > 0 && timingSafeEqual(authHeader, `Bearer ${serviceKey}`);
}

// 관리자 비밀번호 무차별 대입 방어: IP당 15분 10회 실패 시 잠금.
export const ADMIN_FAIL_MAX = 10;
export const ADMIN_FAIL_WINDOW = 15 * 60;

export async function adminLocked(req: Request): Promise<boolean> {
  return !(await rateLimit(`admin-fail:${clientIp(req)}`, ADMIN_FAIL_MAX, ADMIN_FAIL_WINDOW, false));
}

export async function recordAdminFail(req: Request): Promise<void> {
  await recordRate(`admin-fail:${clientIp(req)}`);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
