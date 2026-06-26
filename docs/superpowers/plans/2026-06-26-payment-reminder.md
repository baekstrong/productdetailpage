# 운영자 결제 안내 리마인더(D-7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수업 7일 전(KST 09시) 미결제 신청자가 있는 수업에 대해 운영자(백관장)에게 "결제 안내를 보낼 시점" 리마인더 문자 1통을 보낸다.

**Architecture:** 매일 도는 Supabase pg_cron이 신규 Edge Function `payment-reminder`를 호출 → 함수가 "오늘+7일·미발송·미결제 신청자≥1" 수업을 찾아 `solapi-reservations` 경유로 운영자에게 문자 발송 + `classes.payment_reminder_sent_at` 기록(멱등). 기존 Solapi·message_logs·service_role 패턴을 재사용한다.

**Tech Stack:** Supabase Postgres(컬럼·pg_cron·pg_net), Deno/TypeScript Edge Functions, Solapi, Python `unittest` 계약 테스트.

## Global Constraints

- 시크릿은 Edge Function 환경변수(Deno.env)로만. `SUPABASE_SERVICE_ROLE_KEY`·`ADMIN_PHONE`·`SOLAPI_*`를 코드/저장소에 하드코딩 금지.
- Edge Function 인증은 내부 호출 `Authorization: Bearer <service_role>`을 `timingSafeEqual`로 검증(기존 패턴).
- 운영자 문자엔 `[근력학교]` 접두어·마케팅 문구 금지(기존 톤 정책).
- 발송은 베스트 에포트(Solapi/시크릿 문제로 실패해도 함수는 200, 다른 수업 처리 계속).
- 시각은 KST 기준(서버 UTC). 날짜·요일 계산은 타임존 안전하게(정오 UTC 또는 +9h).
- 커밋 메시지는 한글. 계약 테스트(`python3 -m unittest tests.test_static_pages`)는 항상 통과.

---

### Task 1: DB 컬럼 `payment_reminder_sent_at`

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Produces: `classes.payment_reminder_sent_at`(timestamptz, nullable). NULL이면 아직 리마인더 미발송.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `StaticPageTests`에 추가:
```python
    def test_payment_reminder_schema(self):
        schema = read_page("supabase/schema.sql")
        self.assertIn("payment_reminder_sent_at timestamptz", schema)
        self.assertIn("add column if not exists payment_reminder_sent_at", schema)
```

- [ ] **Step 2: 테스트 실패 확인**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_payment_reminder_schema -v` → FAIL

- [ ] **Step 3: 컬럼 추가**

`supabase/schema.sql`에서 `classes` 테이블 정의 안 `preview_before_open boolean not null default false,` 줄 다음에 추가:
```sql
  preview_before_open boolean not null default false,
  payment_reminder_sent_at timestamptz,
  google_event_id text,
```
(현재 `preview_before_open ...,` 다음이 `google_event_id text,`이므로 그 사이에 한 줄 삽입.)

그리고 기존 테이블 보강용 `alter` 묶음(`alter table public.classes add column if not exists preview_before_open ...;` 줄) 바로 다음에 추가:
```sql
alter table public.classes add column if not exists payment_reminder_sent_at timestamptz;
```

- [ ] **Step 4: 테스트 통과**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_payment_reminder_schema -v` → PASS
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 5: 커밋**
```bash
git add supabase/schema.sql tests/test_static_pages.py
git commit -m "결제 리마인더: classes.payment_reminder_sent_at 컬럼 추가"
```

---

### Task 2: `solapi-reservations` 운영자 리마인더 템플릿

**Files:**
- Modify: `supabase/functions/solapi-reservations/index.ts`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Produces: `MessageType`에 `'admin_payment_reminder'` 추가, `templates`에 동명 템플릿. `values`로 `{class_label}`·`{count}` 채움.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_sms_automation_seat_reminder_review_and_cancel` 메서드(안에서 `solapi = read_page("supabase/functions/solapi-reservations/index.ts")` 정의됨)에 추가:
```python
        self.assertIn("admin_payment_reminder", solapi)
        self.assertIn("7일 앞입니다", solapi)
```

- [ ] **Step 2: 테스트 실패 확인**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_sms_automation_seat_reminder_review_and_cancel -v` → FAIL

- [ ] **Step 3: MessageType 유니온에 추가**

`supabase/functions/solapi-reservations/index.ts`의 `MessageType` 정의 마지막 줄:
```ts
  | 'reservation_cancelled';
```
다음으로 변경:
```ts
  | 'reservation_cancelled'
  | 'admin_payment_reminder';
```

- [ ] **Step 4: templates에 템플릿 추가**

같은 파일 `templates` 객체에서 `reservation_cancelled` 템플릿 항목 뒤(객체 닫는 `};` 직전)에 추가. `reservation_cancelled` 항목 끝을 찾아 그 뒤에:
```ts
  // 운영자(백관장)용 D-7 결제 안내 리마인더
  admin_payment_reminder: `[케틀벨 원데이 리마인더]
{class_label} 수업이 7일 앞입니다.
현재 신청 {count}명 — 선착순 승인하고 결제 안내를 보내주세요.`,
```
(주의: `templates`는 `Record<MessageType, string>`이라 새 키를 반드시 추가해야 타입이 맞는다. `fillTemplate`이 `{class_label}`·`{count}`를 `values`에서 치환한다 — 기존 치환 방식과 동일.)

- [ ] **Step 5: 테스트 통과**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_sms_automation_seat_reminder_review_and_cancel -v` → PASS
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 6: 커밋**
```bash
git add supabase/functions/solapi-reservations/index.ts tests/test_static_pages.py
git commit -m "solapi: 운영자 결제 리마인더 템플릿 admin_payment_reminder 추가"
```

---

### Task 3: 신규 Edge Function `payment-reminder`

**Files:**
- Create: `supabase/functions/payment-reminder/index.ts`
- Modify: `supabase/config.toml`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `classes.payment_reminder_sent_at`(Task 1), solapi 템플릿 `admin_payment_reminder`(Task 2).
- Produces: POST 엔드포인트. 내부 호출(Bearer service_role)만 허용. 오늘+7일·미발송·미결제 신청자≥1 수업에 운영자 문자 발송 + `payment_reminder_sent_at` 기록. JSON `{ ok, target_date, classes_checked, reminders_sent }` 반환.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `StaticPageTests`에 추가:
```python
    def test_payment_reminder_function(self):
        fn = read_page("supabase/functions/payment-reminder/index.ts")
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)
        self.assertIn("timingSafeEqual", fn)
        self.assertIn("ADMIN_PHONE", fn)
        self.assertIn("admin_payment_reminder", fn)
        self.assertIn("payment_reminder_sent_at", fn)
        self.assertIn("applied,waitlisted,payment_target", fn)
        config = read_page("supabase/config.toml")
        self.assertIn("[functions.payment-reminder]", config)
```

- [ ] **Step 2: 테스트 실패 확인**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_payment_reminder_function -v` → FAIL

- [ ] **Step 3: `payment-reminder/index.ts` 생성**

파일 `supabase/functions/payment-reminder/index.ts`를 다음 내용으로 생성:
```ts
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
      const apps = await supabaseFetch(
        `reservations?class_id=eq.${encodeURIComponent(String(c.id))}&reservation_status=in.(applied,waitlisted,payment_target)&select=id`
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
```

- [ ] **Step 4: `config.toml`에 함수 등록**

`supabase/config.toml`의 함수 블록 묶음 끝(예: `[functions.cancel-reservation]` 블록 다음)에 추가:
```toml
[functions.payment-reminder]
verify_jwt = false
```

- [ ] **Step 5: 테스트 통과 + 문법 확인**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_payment_reminder_function -v` → PASS
Run(가능하면): `deno check supabase/functions/payment-reminder/index.ts` 또는 최소 괄호/따옴표 짝 확인.
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 6: 커밋**
```bash
git add supabase/functions/payment-reminder/index.ts supabase/config.toml tests/test_static_pages.py
git commit -m "payment-reminder: D-7 운영자 리마인더 Edge Function 신규"
```

---

### Task 4: `admin-reservations` 날짜 변경 시 이력 초기화

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts` (`updateClass`)
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `classes.payment_reminder_sent_at`(Task 1).
- Produces: `updateClass`가 `class_date` 변경 요청이면 `payment_reminder_sent_at`을 NULL로 초기화 → 새 날짜 기준 D-7에 재발송.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_supabase_schema_and_edge_functions_are_documented` 메서드(안에서 `admin_fn = read_page("supabase/functions/admin-reservations/index.ts")` 정의됨)에 추가:
```python
        self.assertIn("payment_reminder_sent_at", admin_fn)
```

- [ ] **Step 2: 테스트 실패 확인**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_supabase_schema_and_edge_functions_are_documented -v` → FAIL

- [ ] **Step 3: `updateClass`에 초기화 추가**

`supabase/functions/admin-reservations/index.ts`의 `updateClass`에서 현재:
```ts
async function updateClass(classId: string, updates: Record<string, unknown>) {
  if (!classId) throw new Error('classId is required');
  const row = pickClassFields(updates || {});
  row.updated_at = new Date().toISOString();
```
다음으로 변경(`updated_at` 줄 다음에 한 줄 추가):
```ts
async function updateClass(classId: string, updates: Record<string, unknown>) {
  if (!classId) throw new Error('classId is required');
  const row = pickClassFields(updates || {});
  row.updated_at = new Date().toISOString();
  // 수업 날짜를 바꾸면 결제 리마인더 이력을 초기화 — 새 날짜 기준 D-7에 다시 가도록.
  if (row.class_date !== undefined) row.payment_reminder_sent_at = null;
```
(`pickClassFields`는 `class_date`가 입력에 있을 때만 `row.class_date`를 채우므로, 날짜 수정 요청에서만 초기화된다.)

- [ ] **Step 4: 테스트 통과**
Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_supabase_schema_and_edge_functions_are_documented -v` → PASS
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 5: 커밋**
```bash
git add supabase/functions/admin-reservations/index.ts tests/test_static_pages.py
git commit -m "admin-reservations: 수업 날짜 변경 시 결제 리마인더 이력 초기화"
```

---

### Task 5: 통합 검증 + 문서 + 배포 안내

**Files:**
- Modify: `docs/progress.md`
- Test: 전체 계약 테스트

- [ ] **Step 1: 전체 계약 테스트**
Run: `python3 -m unittest tests.test_static_pages -v` → 전부 PASS

- [ ] **Step 2: 로직 점검(코드 리뷰 수준)**
- `targetDateKst()`가 KST 오늘+7일을 정확히 내는지(서버 UTC +9h +7d).
- 신청자 집계 필터가 `applied,waitlisted,payment_target`만(취소·결제완료 제외)인지.
- 멱등: `payment_reminder_sent_at is.null` 조건 + 발송 후 PATCH로 중복 방지.
- 인증: service_role Bearer 불일치 시 401.

- [ ] **Step 3: progress.md 갱신**
`docs/progress.md` 상단에 `🆕 운영자 결제 안내 리마인더(D-7)(2026-06-26)` 요약 추가(컬럼·solapi 템플릿·payment-reminder 함수·날짜변경 초기화·pg_cron·ADMIN_PHONE, **배포 필요**). `마지막 갱신` 갱신.

- [ ] **Step 4: progress.md 커밋 + push**
```bash
git add docs/progress.md
git commit -m "docs: 운영자 결제 리마인더 기능 진행상황 반영"
git push
```

- [ ] **Step 5: 배포 안내(사용자 전달 — 코드 작업 아님)**
정적 페이지 외에 **DB·함수·cron·시크릿 설정이 필요**하다. 다음을 안내한다:
1. SQL Editor에서 `alter table public.classes add column if not exists payment_reminder_sent_at timestamptz;` 실행.
2. 시크릿: `supabase secrets set ADMIN_PHONE=01012345678`(백관장 번호).
3. 함수 배포:
   ```bash
   supabase functions deploy payment-reminder --no-verify-jwt
   supabase functions deploy solapi-reservations --no-verify-jwt
   supabase functions deploy admin-reservations --no-verify-jwt
   ```
4. SQL Editor에서 pg_cron 등록(확장 활성화 + cron.schedule). `<SERVICE_ROLE_KEY>`는 실제 키로:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('payment-reminder-daily', '0 0 * * *', $$
     select net.http_post(
       url := 'https://vjoxzbxcylqyhxezxiuj.supabase.co/functions/v1/payment-reminder',
       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
       body := '{}'::jsonb) $$);
   ```
5. 검증: 7일 뒤 날짜에 신청자 있는 테스트 수업을 만들고 `payment-reminder`를 service_role로 한 번 수동 호출(curl)해 운영자 문자가 오는지 확인.

---

## Self-Review

**Spec coverage:** 컬럼 → Task 1 ✓ / solapi 템플릿 → Task 2 ✓ / payment-reminder 함수(인증·타깃날짜·신청자집계·발송·멱등) → Task 3 ✓ / config.toml → Task 3 ✓ / 날짜변경 초기화 → Task 4 ✓ / pg_cron·시크릿·배포 → Task 5 ✓ / 테스트 → 각 태스크 ✓. 누락 없음.

**Type consistency:** `payment_reminder_sent_at`(컬럼/함수/admin 동일), `admin_payment_reminder`(solapi 템플릿 키 ↔ payment-reminder 호출 messageType 동일), `values` 키 `class_label`·`count`(템플릿 `{class_label}`·`{count}` ↔ payment-reminder `sendAdminSms` 동일). 신청자 필터 문자열 `applied,waitlisted,payment_target` 일치.

**Placeholder scan:** 모든 코드 스텝 실제 코드 포함. cron SQL의 `<SERVICE_ROLE_KEY>`는 배포 시 주입하는 시크릿(코드 아님). "적절히" 류 없음.
