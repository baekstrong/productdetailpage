# 수업 일정 → 구글 캘린더 자동 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 수업을 등록/수정/삭제하면 같은 변경이 구글 캘린더에도 자동 반영되게 한다(근력학교 앱과 같은 서비스 계정·캘린더 재사용, 케틀벨은 Deno에서 직접 호출).

**Architecture:** `admin-reservations` Edge Function(Deno)에 캘린더 모듈(`calendar.ts`)을 추가한다. 서비스 계정 키로 RS256 JWT를 직접 서명해 OAuth 토큰을 받고 Google Calendar REST API를 호출한다. `createClass`/`updateClass`/`deleteClass`가 DB 작업 후 캘린더 이벤트를 생성/갱신/삭제하며, 캘린더 실패는 무시(베스트 에포트)한다. 수업↔이벤트 연결은 `classes.google_event_id` 컬럼으로 한다.

**Tech Stack:** Supabase Edge Functions(Deno/TypeScript), Deno `crypto.subtle`(RS256 서명), Google Calendar v3 REST, Python unittest 계약 테스트. 새 npm 의존성 없음.

**사용자 확정 사항:** API 즉시 연동 / 등록·수정·삭제 모두 / 근력학교와 같은 캘린더 / 케틀벨 직접 연동 / 이벤트 제목 `[케틀벨 원데이] 6월 27일 (토)`.

---

## 파일 구조

- Modify: `supabase/schema.sql` — `classes`에 `google_event_id` 컬럼 + alter 문(기존 테이블 대응)
- Create: `supabase/functions/admin-reservations/calendar.ts` — 캘린더 인증·이벤트 CRUD 모듈
- Modify: `supabase/functions/admin-reservations/index.ts` — createClass/updateClass/deleteClass에 캘린더 호출 통합
- Modify: `tests/test_static_pages.py` — 계약 테스트 추가
- Modify: `docs/progress.md`, `CLAUDE.md` — 기능 반영

---

### Task 1: 스키마 — google_event_id 컬럼

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: classes 테이블 정의에 컬럼 추가**

`supabase/schema.sql`의 `create table if not exists public.classes (...)` 블록에서 `status text ... ,` 줄 다음, `created_at` 줄 앞에 추가:

```sql
  google_event_id text,
```

- [ ] **Step 2: 기존 테이블용 alter 문 추가**

`create table if not exists public.classes (...)` 블록이 끝나는 `);` 바로 다음 줄에 추가(이미 만들어진 라이브 테이블에는 create로 컬럼이 안 생기므로):

```sql

-- 기존 classes 테이블에 캘린더 이벤트 연결용 컬럼 추가(수업↔구글 캘린더 이벤트 매핑).
alter table public.classes add column if not exists google_event_id text;
```

- [ ] **Step 3: 계약 테스트로 확인**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 기존 테스트 전부 PASS (이 단계는 스키마 문자열 추가만, 깨질 것 없음)

- [ ] **Step 4: 커밋**

```bash
git add supabase/schema.sql
git commit -m "feat: classes에 google_event_id 컬럼 추가 (캘린더 이벤트 연결용)"
```

### Task 2: 캘린더 모듈 calendar.ts

**Files:**
- Create: `supabase/functions/admin-reservations/calendar.ts`

- [ ] **Step 1: 모듈 전문 작성**

`supabase/functions/admin-reservations/calendar.ts` 에 아래 전문을 작성한다. 시크릿은 `Deno.env`로만 접근하며, 미설정 시 안전하게 skip한다.

```ts
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
  return {
    summary: formatEventTitle(c.class_date),
    location: c.place || '근력학교 고대점',
    description: `케틀벨 원데이 수업 예약/안내 페이지: ${PRODUCT_URL}`,
    start: { dateTime: `${c.class_date}T${hm(c.start_time)}:00`, timeZone: 'Asia/Seoul' },
    end: { dateTime: `${c.class_date}T${hm(c.end_time) || '16:00'}:00`, timeZone: 'Asia/Seoul' },
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
```

- [ ] **Step 2: 문법 육안 확인**

Deno 미설치 환경이므로 타입체크 대신 파일을 다시 읽어 import/export·괄호 짝을 확인한다. (계약 테스트는 Task 4에서)

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/admin-reservations/calendar.ts
git commit -m "feat: 구글 캘린더 동기화 모듈 calendar.ts (서비스계정 JWT→OAuth→Calendar REST)"
```

### Task 3: admin-reservations 통합

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: 모듈 import 추가**

`index.ts` 최상단 `import { serve } ...` 줄 다음에 추가:

```ts
import { createEvent, updateEvent, deleteEvent } from './calendar.ts';
```

- [ ] **Step 2: createClass에 캘린더 생성 통합**

기존 `createClass`(Task 컨텍스트의 223~234행)를 아래로 교체:

```ts
async function createClass(input: Record<string, unknown>) {
  const row = pickClassFields(input || {});
  if (!row.class_date || !row.start_time || !row.end_time) {
    throw new Error('class_date, start_time, end_time are required');
  }
  const created = await supabaseFetch('classes', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const classRow = Array.isArray(created) ? created[0] : created;
  // 캘린더 이벤트 생성(베스트 에포트) 후 event_id 연결.
  if (classRow && classRow.id) {
    const eventId = await createEvent(classRow);
    if (eventId) {
      await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(classRow.id))}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ google_event_id: eventId }),
      });
      classRow.google_event_id = eventId;
    }
  }
  return { ok: true, class: classRow };
}
```

- [ ] **Step 3: updateClass에 캘린더 갱신 통합**

기존 `updateClass`(236~246행)를 아래로 교체:

```ts
async function updateClass(classId: string, updates: Record<string, unknown>) {
  if (!classId) throw new Error('classId is required');
  const row = pickClassFields(updates || {});
  row.updated_at = new Date().toISOString();
  const updated = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const classRow = Array.isArray(updated) ? updated[0] : updated;
  // 캘린더 반영(베스트 에포트): 이벤트가 있으면 갱신, 없으면 새로 생성 후 연결.
  if (classRow && classRow.id) {
    if (classRow.google_event_id) {
      await updateEvent(String(classRow.google_event_id), classRow);
    } else {
      const eventId = await createEvent(classRow);
      if (eventId) {
        await supabaseFetch(`classes?id=eq.${encodeURIComponent(String(classRow.id))}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ google_event_id: eventId }),
        });
        classRow.google_event_id = eventId;
      }
    }
  }
  return { ok: true, class: classRow };
}
```

- [ ] **Step 4: deleteClass에 캘린더 삭제 통합**

기존 `deleteClass`(248~253행)를 아래로 교체:

```ts
async function deleteClass(classId: string) {
  if (!classId) throw new Error('classId is required');
  // 삭제 전에 연결된 캘린더 이벤트 id를 확보해 캘린더에서도 제거(베스트 에포트).
  const rows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=google_event_id`);
  const eventId = Array.isArray(rows) && rows[0] ? String(rows[0].google_event_id || '') : '';
  if (eventId) await deleteEvent(eventId);
  // public.reservations rows for this class are removed via ON DELETE CASCADE.
  await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}`, { method: 'DELETE' });
  return { ok: true };
}
```

- [ ] **Step 5: 계약 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 기존 테스트 PASS (Task 4에서 신규 추가)

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 수업 등록/수정/삭제 시 구글 캘린더 이벤트 동기화"
```

### Task 4: 계약 테스트

**Files:**
- Modify: `tests/test_static_pages.py`

- [ ] **Step 1: 테스트 추가**

`tests/test_static_pages.py`의 마지막 테스트 메서드 뒤, `if __name__` 앞에 추가:

```python
    def test_google_calendar_sync(self):
        cal = read_page("supabase/functions/admin-reservations/calendar.ts")
        idx = read_page("supabase/functions/admin-reservations/index.ts")
        schema = read_page("supabase/schema.sql")

        # 캘린더 모듈: 서비스계정 JWT(RS256) → OAuth → Calendar REST
        self.assertIn("oauth2.googleapis.com/token", cal)
        self.assertIn("RSASSA-PKCS1-v1_5", cal)
        self.assertIn("GOOGLE_CLIENT_EMAIL", cal)
        self.assertIn("GOOGLE_PRIVATE_KEY", cal)
        self.assertIn("GOOGLE_CALENDAR_ID", cal)
        self.assertIn("calendar/v3/calendars", cal)
        self.assertIn("Asia/Seoul", cal)
        self.assertIn("[케틀벨 원데이]", cal)
        self.assertIn("export async function createEvent", cal)
        self.assertIn("export async function updateEvent", cal)
        self.assertIn("export async function deleteEvent", cal)
        # 시크릿 하드코딩 금지(Deno.env로만)
        self.assertNotIn("BEGIN PRIVATE KEY-----\\nMI", cal)

        # 통합: import + 세 CRUD에서 호출 + event_id 저장
        self.assertIn("from './calendar.ts'", idx)
        self.assertIn("createEvent", idx)
        self.assertIn("updateEvent", idx)
        self.assertIn("deleteEvent", idx)
        self.assertIn("google_event_id", idx)

        # 스키마: 컬럼 추가
        self.assertIn("google_event_id", schema)
```

- [ ] **Step 2: 실행**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 전부 PASS (신규 테스트 포함)

- [ ] **Step 3: 커밋**

```bash
git add tests/test_static_pages.py
git commit -m "test: 구글 캘린더 동기화 계약 테스트 추가"
```

### Task 5: 문서 갱신

**Files:**
- Modify: `docs/progress.md`, `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md** — Edge Functions 설명에 admin-reservations가 캘린더 동기화도 함을 한 줄 추가, 시크릿 목록에 `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID` 언급.
- [ ] **Step 2: progress.md** — 기능 완료 + 배포/설정 체크리스트(시크릿 3개, alter 컬럼, 재배포) 반영, 마지막 갱신 날짜.
- [ ] **Step 3: 커밋 + push**

```bash
git add -A && git commit -m "docs: 구글 캘린더 동기화 기능 반영" && git push
```

### Task 6: 배포 + 설정 (사용자 협조 필요)

- [ ] **Step 1: 라이브 DB에 컬럼 추가** — SQL Editor에서:

```sql
alter table public.classes add column if not exists google_event_id text;
```

- [ ] **Step 2: Supabase 시크릿 등록** (근력학교 `.env` 값 재사용):

```bash
supabase secrets set GOOGLE_CLIENT_EMAIL="<근력학교와 동일>" --project-ref vjoxzbxcylqyhxezxiuj
supabase secrets set GOOGLE_PRIVATE_KEY="<근력학교와 동일>" --project-ref vjoxzbxcylqyhxezxiuj
supabase secrets set GOOGLE_CALENDAR_ID="<근력학교와 동일>" --project-ref vjoxzbxcylqyhxezxiuj
```

- [ ] **Step 3: 함수 재배포**

```bash
supabase functions deploy admin-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt
```

- [ ] **Step 4: 수동 검증** — admin에서 수업 등록 → 구글 캘린더에 `[케틀벨 원데이] …` 이벤트 생성 / 수정 → 시간 반영 / 삭제 → 이벤트 사라짐. 서비스 계정이 대상 캘린더에 "일정 변경" 권한으로 공유돼 있어야 함(근력학교에서 이미 설정됐으면 그대로).

---

## Self-Review

- **스펙 커버리지:** 인증(Task 2 getAccessToken) / 이벤트 내용(eventBody) / 등록·수정·삭제(Task 3) / google_event_id(Task 1·3) / 시크릿(Task 6) / 베스트 에포트(calApi·try-catch) / 테스트(Task 4) — 모두 매핑됨.
- **플레이스홀더:** 없음(모든 코드 전문 포함).
- **타입 일관성:** `createEvent(c: ClassEvent): Promise<string|null>`, `updateEvent(eventId, c)`, `deleteEvent(eventId)` — index.ts 호출부와 시그니처 일치. `google_event_id` 컬럼명 전 구간 동일.
