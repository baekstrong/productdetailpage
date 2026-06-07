# 문자 자동화 마무리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여석 안내(수동 즉시), 수업 전 리마인드·수업 후 복습(결제 완료 시 Solapi 예약 발송), 취소 시 예약 발송 취소까지 자동화를 마무리한다.

**Architecture:** 외부 스케줄러 없이 Solapi 예약 발송(`scheduledDate`)을 사용한다. `solapi-reservations`는 발송/예약/취소를 캡슐화하고, `admin-reservations`가 상태 전환에 따라 무엇을 보내고/예약하고/취소할지 결정한다. `admin.html`은 "여석 안내" 액션만 추가한다.

**Tech Stack:** Supabase Edge Functions(Deno/TypeScript), Solapi v4 HTTP API(HMAC-SHA256), 정적 HTML + vanilla JS, Python `unittest` 계약 테스트.

**참고 문서:** 설계 `docs/superpowers/specs/2026-06-07-sms-automation-design.md`

---

## 파일 구조

- `supabase/functions/solapi-reservations/index.ts` — 예약 발송 시 groupId 반환, 예약 취소(`cancelGroupId`) 분기, 인증 헤더 헬퍼 추출.
- `supabase/functions/admin-reservations/index.ts` — KST 예약시각 계산, scheduledAt/groupId plumbing, 여석 안내 오버라이드, 결제 완료 시 예약 등록, 취소/만료 시 예약 취소.
- `admin.html` — "여석 안내" 일괄 액션 버튼 + 매핑.
- `tests/test_static_pages.py` — 신규 계약 테스트.

**테스트 전략:** 이 저장소엔 Deno 테스트 인프라가 없다(테스트는 Python 계약 테스트). 따라서 (1) 마크업/소스 필수 문자열은 Python 계약 테스트로 강제하고, (2) KST 시각 계산 같은 순수 로직은 `node -e`로 수치 검증하며, (3) 실제 발송/예약/취소는 배포 후 수동 스모크로 검증한다.

---

## Task 1: solapi-reservations — 인증 헤더 헬퍼 추출

**Files:**
- Modify: `supabase/functions/solapi-reservations/index.ts`

- [ ] **Step 1: 인증 헤더 빌더 추가**

`randomSalt()` 함수 정의 바로 아래에 헬퍼를 추가한다:

```ts
async function buildAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = randomSalt();
  const signature = await hmacSha256Hex(apiSecret, date + salt);
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}
```

- [ ] **Step 2: sendSolapi가 헬퍼를 쓰도록 교체**

`sendSolapi` 안의 다음 4줄

```ts
  const date = new Date().toISOString();
  const salt = randomSalt();
  const signature = await hmacSha256Hex(SOLAPI_API_SECRET, date + salt);
  const authorization = `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
```

를 한 줄로 바꾼다:

```ts
  const authorization = await buildAuthHeader(SOLAPI_API_KEY, SOLAPI_API_SECRET);
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/solapi-reservations/index.ts
git commit -m "refactor: solapi 인증 헤더 빌더 추출"
```

---

## Task 2: solapi-reservations — 예약 발송 응답에 groupId 반환

**Files:**
- Modify: `supabase/functions/solapi-reservations/index.ts`

- [ ] **Step 1: 성공 응답에 groupId 추가**

`sendSolapi`의 성공 return을 다음으로 교체한다:

```ts
  return {
    ok: true,
    provider: 'solapi',
    to: maskPhone(to),
    messageId: result.messageId || (result.groupInfo && result.groupInfo._id) || null,
    groupId: result.groupId || (result.groupInfo && result.groupInfo._id) || null,
    status: result.statusCode || 'sent',
    scheduledAt,
  };
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/functions/solapi-reservations/index.ts
git commit -m "feat: solapi 발송 응답에 groupId 반환 (예약 취소용)"
```

---

## Task 3: solapi-reservations — 예약 취소(cancelGroupId) 분기

**Files:**
- Modify: `supabase/functions/solapi-reservations/index.ts`

- [ ] **Step 1: cancelSchedule 함수 추가**

`jsonResponse` 함수 정의 바로 위에 추가한다:

```ts
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
```

- [ ] **Step 2: serve에서 취소 분기 추가**

`serve` 안의 `await assertAdminPassword(String(body.password || ''));` 바로 다음 줄에 추가한다:

```ts
    // 예약 발송 취소 요청(서버사이드 admin-reservations에서 호출).
    if (body.cancelGroupId) {
      const result = await cancelSchedule(String(body.cancelGroupId));
      return jsonResponse(result);
    }
```

- [ ] **Step 3: Deno 문법 확인 (가능 시)**

Run: `deno check supabase/functions/solapi-reservations/index.ts`
Expected: 에러 없음. (deno 미설치 시 이 단계는 건너뛰고 배포 시 확인.)

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/solapi-reservations/index.ts
git commit -m "feat: solapi 예약 발송 취소(cancelGroupId) 분기 추가"
```

---

## Task 4: admin-reservations — KST 예약시각 계산 헬퍼

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: 헬퍼 추가**

`formatSchedule` 함수 정의 바로 위에 추가한다:

```ts
// 예약 발송 시각 계산(KST). scheduledDate는 Solapi에 보낼 "YYYY-MM-DD HH:mm:ss"(KST 로컬),
// atMs는 과거 여부 비교용 절대시각(ms). Edge 런타임은 UTC이므로 KST는 직접 계산한다.
function kstReminderSchedule(classDate: string): { scheduledDate: string; atMs: number } | null {
  const base = new Date(`${classDate}T00:00:00Z`);
  if (isNaN(base.getTime())) return null;
  const prev = new Date(base.getTime() - 24 * 60 * 60 * 1000); // 수업 전날
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const d = String(prev.getUTCDate()).padStart(2, '0');
  return { scheduledDate: `${y}-${m}-${d} 18:00:00`, atMs: new Date(`${y}-${m}-${d}T18:00:00+09:00`).getTime() };
}

function kstReviewSchedule(classDate: string, endTime: string): { scheduledDate: string; atMs: number } | null {
  const hm = String(endTime || '').slice(0, 5);
  if (!classDate || !/^\d{2}:\d{2}$/.test(hm)) return null;
  return { scheduledDate: `${classDate} ${hm}:00`, atMs: new Date(`${classDate}T${hm}:00+09:00`).getTime() };
}
```

- [ ] **Step 2: 순수 로직 수치 검증 (node)**

Run:

```bash
node -e '
function kstReminderSchedule(classDate){const base=new Date(classDate+"T00:00:00Z");if(isNaN(base.getTime()))return null;const prev=new Date(base.getTime()-24*60*60*1000);const y=prev.getUTCFullYear();const m=String(prev.getUTCMonth()+1).padStart(2,"0");const d=String(prev.getUTCDate()).padStart(2,"0");return{scheduledDate:`${y}-${m}-${d} 18:00:00`,atMs:new Date(`${y}-${m}-${d}T18:00:00+09:00`).getTime()};}
function kstReviewSchedule(classDate,endTime){const hm=String(endTime||"").slice(0,5);if(!classDate||!/^\d{2}:\d{2}$/.test(hm))return null;return{scheduledDate:`${classDate} ${hm}:00`,atMs:new Date(`${classDate}T${hm}:00+09:00`).getTime()};}
const r=kstReminderSchedule("2026-06-13");
const v=kstReviewSchedule("2026-06-13","16:00");
console.log("reminder", r.scheduledDate);
console.log("review", v.scheduledDate);
console.assert(r.scheduledDate==="2026-06-12 18:00:00","reminder date wrong");
console.assert(v.scheduledDate==="2026-06-13 16:00:00","review date wrong");
console.log("OK");
'
```

Expected: 출력에 `reminder 2026-06-12 18:00:00`, `review 2026-06-13 16:00:00`, `OK`.

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 리마인드/복습 예약시각(KST) 계산 헬퍼 추가"
```

---

## Task 5: admin-reservations — scheduledAt/groupId plumbing

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: sendSms에 scheduledAt 전달**

`sendSms` 함수를 다음으로 교체한다:

```ts
async function sendSms(password: string, messageType: string, phone: string, values: Record<string, string>, scheduledAt?: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ password, messageType, phone, values, scheduledAt }),
    });
    return await response.json().catch(() => ({ ok: false, error: 'invalid solapi response' }));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'solapi call failed' };
  }
}
```

- [ ] **Step 2: logMessage에 status(scheduled)·groupId·scheduled_at 반영**

`logMessage` 함수를 다음으로 교체한다:

```ts
async function logMessage(reservationId: string, messageType: string, phone: string, result: Record<string, unknown>, scheduledAt?: string) {
  try {
    const ok = Boolean(result && result.ok);
    const status = ok ? (scheduledAt ? 'scheduled' : 'sent') : (result && result.skipped ? 'skipped' : 'failed');
    await supabaseFetch('message_logs', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        reservation_id: reservationId,
        message_type: messageType,
        phone_masked: maskPhone(phone),
        provider_message_id: (result && ((result.groupId as string) || (result.messageId as string))) || null,
        status,
        error_message: ok ? null : ((result && (result.error || result.reason)) as string) || null,
        scheduled_at: scheduledAt || null,
        sent_at: new Date().toISOString(),
      }),
    });
  } catch (_) {
    // 로깅 실패는 무시(베스트 에포트)
  }
}
```

- [ ] **Step 3: notify에 scheduledAt 전달**

`notify` 함수를 다음으로 교체한다:

```ts
async function notify(password: string, reservation: Record<string, unknown>, messageType: string, values: Record<string, string>, scheduledAt?: string) {
  const phone = String(reservation?.phone || '');
  if (!phone) return;
  const result = await sendSms(password, messageType, phone, values, scheduledAt);
  await logMessage(String(reservation.id), messageType, phone, result as Record<string, unknown>, scheduledAt);
}
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: admin-reservations 문자 발송에 예약(scheduledAt)·groupId plumbing"
```

---

## Task 6: admin-reservations — classInfo가 원시 일정 필드 노출

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: classInfo 반환 확장**

`classInfo` 함수를 다음으로 교체한다:

```ts
async function classInfo(classId: string): Promise<{ label: string; place: string; class_date: string; end_time: string }> {
  if (!classId) return { label: '', place: '', class_date: '', end_time: '' };
  const rows = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=class_date,start_time,end_time,place`);
  if (Array.isArray(rows) && rows[0]) {
    return {
      label: formatSchedule(rows[0].class_date, rows[0].start_time, rows[0].end_time),
      place: rows[0].place || '근력학교 고대점',
      class_date: String(rows[0].class_date || ''),
      end_time: String(rows[0].end_time || ''),
    };
  }
  return { label: '', place: '', class_date: '', end_time: '' };
}
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: classInfo가 class_date·end_time 원시값도 반환"
```

---

## Task 7: admin-reservations — 예약 등록/취소 헬퍼

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: 중복 방지·예약 등록·예약 취소 헬퍼 추가**

`updateReservation` 함수 정의 바로 위에 추가한다:

```ts
// 이미 발송/예약된 후속 문자 타입 집합(결제 완료 재클릭 시 중복 예약 방지).
async function alreadyScheduledTypes(reservationId: string): Promise<Set<string>> {
  const rows = await supabaseFetch(`message_logs?reservation_id=eq.${encodeURIComponent(reservationId)}&message_type=in.(class_reminder,review_material)&status=in.(sent,scheduled)&select=message_type`);
  const set = new Set<string>();
  if (Array.isArray(rows)) for (const r of rows) set.add(String(r.message_type));
  return set;
}

// 결제 완료 시 리마인드(전날 18시)·복습(종료 시각)을 Solapi 예약 발송으로 등록.
async function scheduleFollowups(password: string, reservation: Record<string, unknown>, info: { label: string; place: string; class_date: string; end_time: string }) {
  if (!reservation || !reservation.id || !info.class_date) return;
  const done = await alreadyScheduledTypes(String(reservation.id));
  const now = Date.now();
  const reminder = kstReminderSchedule(info.class_date);
  if (reminder && reminder.atMs > now && !done.has('class_reminder')) {
    await notify(password, reservation, 'class_reminder', { class_date: info.label, place: info.place }, reminder.scheduledDate);
  }
  const review = kstReviewSchedule(info.class_date, info.end_time);
  if (review && review.atMs > now && !done.has('review_material')) {
    await notify(password, reservation, 'review_material', { class_date: info.label, place: info.place }, review.scheduledDate);
  }
}

// 취소/만료 시 해당 예약의 예약된 리마인드·복습 문자를 Solapi에서 취소.
async function cancelScheduledFollowups(password: string, reservationId: string) {
  if (!reservationId) return;
  const rows = await supabaseFetch(`message_logs?reservation_id=eq.${encodeURIComponent(reservationId)}&status=eq.scheduled&message_type=in.(class_reminder,review_material)&select=id,provider_message_id`);
  if (!Array.isArray(rows)) return;
  const { url, serviceKey } = getSupabaseAdmin();
  for (const row of rows) {
    const groupId = String(row.provider_message_id || '');
    if (!groupId) continue;
    try {
      const res = await fetch(`${url}/functions/v1/solapi-reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ password, cancelGroupId: groupId }),
      });
      const result = await res.json().catch(() => ({ ok: false }));
      if (result && result.ok) {
        await supabaseFetch(`message_logs?id=eq.${encodeURIComponent(String(row.id))}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'cancelled' }),
        });
      }
    } catch (_) {
      // 취소 실패는 무시(베스트 에포트)
    }
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 후속 문자 예약 등록/취소 + 중복 방지 헬퍼"
```

---

## Task 8: admin-reservations — updateReservation에 전체 흐름 연결

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: updateReservation 교체 (notifyOverride + 예약 등록/취소)**

`updateReservation` 함수를 다음으로 교체한다:

```ts
async function updateReservation(reservationId: string, updates: Record<string, unknown>, password: string, notifyOverride?: string) {
  const allowedKeys = new Set(['reservation_status', 'payment_status', 'waitlist_order', 'admin_memo']);
  const safeUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates || {})) {
    if (allowedKeys.has(key)) safeUpdates[key] = value;
  }
  if (!reservationId) throw new Error('reservationId is required');

  const reservation = await supabaseFetch(`reservations?id=eq.${encodeURIComponent(reservationId)}&select=*`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(safeUpdates),
  });
  const updated = Array.isArray(reservation) ? reservation[0] : reservation;

  // 상태 전환에 맞춰 안내 문자 발송/예약/취소 (베스트 에포트)
  if (updated) {
    if (updated.payment_status === 'expired') {
      const info = await classInfo(String(updated.class_id || ''));
      await notify(password, updated, 'payment_expired', { class_date: info.label, place: info.place });
      await cancelScheduledFollowups(password, String(updated.id));
    } else if (updated.reservation_status === 'cancelled') {
      await cancelScheduledFollowups(password, String(updated.id));
    } else if (updated.reservation_status === 'payment_target' || updated.payment_status === 'sent') {
      const info = await classInfo(String(updated.class_id || ''));
      const messageType = notifyOverride === 'seat_opened' ? 'seat_opened' : 'payment 안내';
      await notify(password, updated, messageType, { class_date: info.label, place: info.place, payment_url: PAYMENT_LINK });
    } else if (updated.reservation_status === 'confirmed' || updated.payment_status === 'paid') {
      const info = await classInfo(String(updated.class_id || ''));
      await notify(password, updated, 'payment_completed', { class_date: info.label, place: info.place });
      await scheduleFollowups(password, updated, info);
    }
  }
  return { ok: true, reservation: updated };
}
```

- [ ] **Step 2: serve에서 body.notify 전달**

`serve` 안의 updateReservation 분기를 다음으로 교체한다:

```ts
    if (action === 'updateReservation') {
      return jsonResponse(await updateReservation(String(body.reservationId || ''), body.updates || {}, password, body.notify ? String(body.notify) : undefined));
    }
```

- [ ] **Step 3: Deno 문법 확인 (가능 시)**

Run: `deno check supabase/functions/admin-reservations/index.ts`
Expected: 에러 없음. (deno 미설치 시 건너뛰고 배포 시 확인.)

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 결제 완료 시 리마인드·복습 예약 등록, 취소/만료 시 예약 취소, 여석 안내 오버라이드"
```

---

## Task 9: admin.html — "여석 안내" 일괄 액션

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 액션 버튼 추가**

일괄 액션바에서 `data-bulk-action="waitlist"` 버튼(대기 처리) 바로 다음 줄에 추가한다:

```html
          <button type="button" data-bulk-action="seat-opened" class="rounded-lg bg-sky-100 px-3 py-2 text-sm font-bold text-sky-700">여석 안내</button>
```

- [ ] **Step 2: BULK_ACTION_UPDATES에 seat-opened 추가**

`BULK_ACTION_UPDATES` 객체에 항목을 추가한다(예: `payment-target` 줄 다음):

```js
      'seat-opened': { reservation_status: 'payment_target', payment_status: 'sent' },
```

- [ ] **Step 3: applyBulkAction에 notify 오버라이드 + 확인 다이얼로그**

`applyBulkAction` 함수에서 `payment-expired` 확인 다이얼로그 줄 다음에 추가한다:

```js
      if (action === 'seat-opened' && !window.confirm(`선택한 ${ids.length}명에게 여석 안내 문자를 보내고 결제 안내 대상으로 전환할까요?`)) return;
```

그리고 같은 함수의 발송 루프

```js
        for (const reservationId of ids) {
          await callAdminApi('updateReservation', { reservationId, updates });
        }
```

를 다음으로 교체한다(seat-opened일 때 notify 오버라이드 전달):

```js
        const notify = action === 'seat-opened' ? 'seat_opened' : undefined;
        for (const reservationId of ids) {
          await callAdminApi('updateReservation', { reservationId, updates, notify });
        }
```

- [ ] **Step 4: 커밋**

```bash
git add admin.html
git commit -m "feat: 관리자 '여석 안내' 일괄 액션 (여석 안내 문자 + 결제 대상 전환)"
```

---

## Task 10: 계약 테스트 추가 + 전체 테스트

**Files:**
- Modify: `tests/test_static_pages.py`

- [ ] **Step 1: 신규 계약 테스트 작성**

`StaticPageTests` 클래스 맨 끝(마지막 메서드 다음)에 추가한다:

```python
    def test_sms_automation_seat_reminder_review_and_cancel(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")

        # 관리자 '여석 안내' 액션
        self.assertIn('data-bulk-action="seat-opened"', admin)
        self.assertIn("여석 안내", admin)
        self.assertIn("'seat-opened'", admin)

        # 예약 등록(리마인드/복습) + 여석 안내 오버라이드 + 취소 연동
        self.assertIn("seat_opened", admin_fn)
        self.assertIn("class_reminder", admin_fn)
        self.assertIn("review_material", admin_fn)
        self.assertIn("kstReminderSchedule", admin_fn)
        self.assertIn("kstReviewSchedule", admin_fn)
        self.assertIn("scheduleFollowups", admin_fn)
        self.assertIn("cancelScheduledFollowups", admin_fn)
        self.assertIn("cancelGroupId", admin_fn)
        self.assertIn("status=eq.scheduled", admin_fn)

        # solapi 예약 취소 엔드포인트 + groupId 반환
        self.assertIn("cancelGroupId", solapi)
        self.assertIn("/schedule", solapi)
        self.assertIn("groupId", solapi)
        self.assertIn("scheduledDate", solapi)
```

- [ ] **Step 2: 전체 테스트 실행**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 모든 테스트 PASS (기존 11 + 신규 1 = 12 OK).

- [ ] **Step 3: 커밋**

```bash
git add tests/test_static_pages.py
git commit -m "test: 문자 자동화(여석/리마인드/복습/취소) 계약 테스트 추가"
```

---

## Task 11: progress.md 갱신 + 푸시

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: progress.md의 "다음에 할 일"·완료 기능 갱신**

"이번까지 완료한 기능"에 문자 자동화 마무리 항목을 추가하고, "다음에 할 일"의 문자 관련 항목을 갱신한다(여석 안내/리마인드/복습/취소 자동화 구현 완료, 남은 것은 배포·실발송 검증). `마지막 갱신` 날짜를 2026-06-07로 한다.

- [ ] **Step 2: 푸시**

```bash
git add -A
git commit -m "docs: progress.md 갱신 (문자 자동화 마무리 구현 완료)"
git push
```

---

## Task 12: 배포 + 수동 스모크 (운영자 협조 필요)

> 코드만으로 끝나지 않는다. 배포엔 Supabase 재로그인(새 PAT)이 필요하다(이전 토큰 폐기됨). 이 Task는 운영자(백관장)와 함께 진행한다.

- [ ] **Step 1: Supabase CLI 준비**

```bash
export PATH="$HOME/.local/share/supabase:$PATH"
supabase login --token <새 PAT>
```

- [ ] **Step 2: 두 함수 배포 (`--no-verify-jwt` 필수)**

```bash
supabase functions deploy solapi-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt
supabase functions deploy admin-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt
```

- [ ] **Step 3: 인증 게이트 스모크**

Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://vjoxzbxcylqyhxezxiuj.supabase.co/functions/v1/solapi-reservations" \
  -H "content-type: application/json" \
  -H "apikey: sb_publishable_U7ezBE8WmH2X2W9EnHx7Rw_q8t8h3HV" \
  -H "authorization: Bearer sb_publishable_U7ezBE8WmH2X2W9EnHx7Rw_q8t8h3HV" \
  --data '{"cancelGroupId":"x","password":"wrong"}'
```

Expected: `401` (invalid password).

- [ ] **Step 4: 실발송/예약/취소 수동 검증 (운영자 폰)**

1. 고객 페이지에서 본인 번호로 예약 → admin에서 **결제 완료 처리**.
2. Supabase SQL Editor에서 확인:
   ```sql
   select message_type, status, provider_message_id, scheduled_at
   from public.message_logs order by created_at desc limit 5;
   ```
   `class_reminder`, `review_material` 2건이 `status='scheduled'`, `provider_message_id`(groupId) 채워짐. Solapi 콘솔 예약 내역 2건 확인.
3. 같은 건 **취소 처리** → 위 두 행이 `status='cancelled'`, Solapi 예약 내역 사라짐.
4. 대기자 1건 **여석 안내** → 여석 안내 문자 수신 + 상태 `payment_target` 전환 확인.

- [ ] **Step 5: progress.md에 배포·검증 완료 반영 후 푸시**
