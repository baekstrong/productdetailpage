// 구글 캘린더 동기화 모듈 — 서비스 계정 JWT(RS256)로 OAuth 토큰을 받아 Calendar v3 REST를 호출한다.
// 시크릿(GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/GOOGLE_CALENDAR_ID) 미설정 시 모든 호출은 조용히 skip한다.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const PRODUCT_URL = 'https://baekstrong.github.io/productdetailpage/';

export interface ClassEvent {
  class_date: string;
  start_time: string;
  end_time: string;
  place?: string;
}

function base64url(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 1) bin += String.fromCharCode(data[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlStr(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

// PEM(또는 \n이 이스케이프된 환경변수 형태)에서 DER 바이트 추출.
function pemToDer(pem: string): Uint8Array {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) der[i] = bin.charCodeAt(i);
  return der;
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY');
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: clientEmail, scope: CALENDAR_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64urlStr(JSON.stringify(header))}.${base64urlStr(JSON.stringify(claim))}`;

  try {
    const key = await crypto.subtle.importKey(
      'pkcs8', pemToDer(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const jwt = `${unsigned}.${base64url(new Uint8Array(sig))}`;

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return null;
    cachedToken = { token: data.access_token, exp: now + Number(data.expires_in || 3600) };
    return data.access_token;
  } catch (_) {
    return null;
  }
}

// "2026-06-27" → "[케틀벨 원데이] 6월 27일 (토)"
function formatEventTitle(classDate: string): string {
  const parts = String(classDate || '').split('-');
  if (parts.length !== 3) return '[케틀벨 원데이] 수업';
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  return `[케틀벨 원데이] ${Number(parts[1])}월 ${Number(parts[2])}일 (${dow})`;
}

function eventBody(c: ClassEvent): Record<string, unknown> {
  const hm = (t: string) => String(t || '').slice(0, 5);
  const start = hm(c.start_time);
  const end = hm(c.end_time) || '16:00';
  // 종료 시각이 시작보다 이르면(자정을 넘기는 수업) 종료 날짜를 하루 뒤로.
  let endDate = c.class_date;
  if (end < start) {
    const d = new Date(`${c.class_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    endDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  return {
    summary: formatEventTitle(c.class_date),
    location: c.place || '근력학교 고대점',
    description: `케틀벨 원데이 수업 예약/안내 페이지: ${PRODUCT_URL}`,
    // 근력학교 일정과 구분되도록 파란색(Blueberry)으로 표시.
    colorId: '9',
    start: { dateTime: `${c.class_date}T${start}:00`, timeZone: 'Asia/Seoul' },
    end: { dateTime: `${endDate}T${end}:00`, timeZone: 'Asia/Seoul' },
  };
}

async function calApi(method: string, suffix: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const token = await getAccessToken();
  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID');
  if (!token || !calendarId) return null; // 미설정/토큰 실패 → skip
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${suffix}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return null; // 404(이미 삭제됨) 포함 — 베스트 에포트라 무시
  if (res.status === 204) return {}; // DELETE 성공은 본문 없음
  return await res.json().catch(() => ({}));
}

// 이벤트 생성 → eventId 반환(실패/미설정 시 null).
export async function createEvent(c: ClassEvent): Promise<string | null> {
  try {
    const result = await calApi('POST', '', eventBody(c));
    return (result && (result.id as string)) || null;
  } catch (_) {
    return null;
  }
}

// 기존 이벤트 갱신(제목/시간/장소). 실패 시 무시.
export async function updateEvent(eventId: string, c: ClassEvent): Promise<void> {
  if (!eventId) return;
  try { await calApi('PUT', `/${encodeURIComponent(eventId)}`, eventBody(c)); } catch (_) { /* 무시 */ }
}

// 이벤트 삭제. 실패 시 무시.
export async function deleteEvent(eventId: string): Promise<void> {
  if (!eventId) return;
  try { await calApi('DELETE', `/${encodeURIComponent(eventId)}`); } catch (_) { /* 무시 */ }
}
