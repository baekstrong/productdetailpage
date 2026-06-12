# 1차 마무리 전체 구조 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1차 공개 전 점검에서 나온 구조 개선 — 신청 접수 문자(공개용 submit-reservation 함수 신설 + 중복 차단 + 검증 + 개인정보 동의), 취소 안내 문자, 이메일 필드 제거, 수업 정보 섹션 동적화, 낡은 폴백 제거, bulkApprove 재클릭 가드, 메모 편집 UI, 리마인드 과거시각 skip 로그, admin-auth 죽은 코드 정리.

**Architecture:** 고객 신청을 anon 직접 insert에서 새 Edge Function `submit-reservation`(service_role insert + 검증 + 중복차단 + 접수 문자)으로 옮긴다. `solapi-reservations`는 서버사이드 내부 호출(Bearer service_role key)도 인증으로 인정하게 확장한다(submit-reservation은 관리자 비밀번호를 모르므로). 취소 안내 템플릿을 추가하고 admin-reservations 취소 분기에서 발송한다. index.html은 폴백 mock 대신 에러 안내를 쓰고, 수업 정보 섹션을 로드된 일정으로 채운다.

**Tech Stack:** 기존과 동일 — 정적 HTML + 인라인 vanilla JS, Supabase Edge Functions(Deno/TS), Python unittest 계약 테스트. 새 의존성 없음.

**사용자 확정 사항:** ① 접수 문자 넣기(함수 신설) ② 취소 문자 보내기 ③ 이메일 필드 제거 ④ 미결제 마감 수동 유지(자동화 안 함).

---

## 파일 구조

- Create: `supabase/functions/submit-reservation/index.ts` — 공개 신청 엔드포인트(검증·중복차단·insert·접수 문자)
- Modify: `supabase/functions/solapi-reservations/index.ts` — `reservation_cancelled` 템플릿 + 내부(service_role) 인증 허용
- Modify: `supabase/functions/admin-reservations/index.ts` — 취소 문자, bulkApprove 가드, skip 로그, RESENDABLE 확장
- Delete: `supabase/functions/admin-auth/` — 죽은 코드(토큰 발급하나 아무도 안 씀)
- Modify: `supabase/config.toml` — admin-auth 제거, submit-reservation 추가
- Modify: `supabase/schema.sql` — anon insert 정책 제거 + 활성예약 unique 인덱스
- Modify: `index.html` — 이메일 제거, 동의 체크박스, submit-reservation 호출, 수업정보 동적화, 폴백 제거
- Delete: `data/classes.json` — 낡은 mock 폴백
- Modify: `admin.html` — 이메일 컬럼 제거, 메모 편집, 현황판 행 갱신, admin-auth 참조 제거, 일괄승인 힌트 수정
- Modify: `tests/test_static_pages.py` — 깨지는 계약 갱신 + 신규 계약 추가
- Modify: `CLAUDE.md`, `docs/progress.md` — 구조 변화 반영

깨지는 기존 테스트(반드시 함께 수정): `test_homepage_adds...`(email/classes.json), `test_class_info_shows_next_one_day_class_schedule`(하드코딩 날짜), `test_classes_json_exists_for_public_calendar`(파일 삭제), `test_admin_page...`(admin-auth 참조), `test_supabase_schema...`(admin-auth 읽음), `test_message_status_dashboard`("자동발송 안 함" 사라짐).

---

### Task 1: solapi-reservations — 취소 템플릿 + 내부 service_role 인증

**Files:**
- Modify: `supabase/functions/solapi-reservations/index.ts`
- Test: `tests/test_static_pages.py` (Task 8에서 일괄)

- [ ] **Step 1: MessageType과 템플릿에 `reservation_cancelled` 추가**

`type MessageType` union에 `| 'reservation_cancelled'` 추가. `templates`의 `review_material` 항목 뒤에 추가:

```ts
  // 예약 취소 안내 문자
  reservation_cancelled: `케틀벨 원데이 수업 예약이 취소 처리되었습니다

수업 일정: {class_date}

다시 수강을 원하시면 예약 페이지에서 신청해 주세요
좋은 일정으로 다시 만나 뵙겠습니다`,
```

- [ ] **Step 2: 내부 호출(service_role) 인증 허용**

serve() 안의 `await assertAdminPassword(...)` 한 줄을 아래로 교체. submit-reservation은 관리자 비밀번호를 모르므로, Authorization 헤더가 service_role key와 일치하면(서버사이드 호출만 가능) 비밀번호 없이 통과시킨다:

```ts
    // 인증: ① 서버사이드 내부 호출(Bearer service_role key) 또는 ② 관리자 비밀번호.
    // service_role key는 Edge Function 환경에서만 알 수 있으므로 내부 호출 증명이 된다.
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authHeader = req.headers.get('authorization') || '';
    const isInternalCall = serviceKey.length > 0 && timingSafeEqual(authHeader, `Bearer ${serviceKey}`);
    if (!isInternalCall) await assertAdminPassword(String(body.password || ''));
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/solapi-reservations/index.ts
git commit -m "feat: 취소 안내 문자 템플릿 + 서버사이드 내부 호출 인증 추가"
```

### Task 2: submit-reservation 함수 신설

**Files:**
- Create: `supabase/functions/submit-reservation/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: 함수 작성** — 전문:

```ts
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
  return isNaN(start.getTime()) || start.getTime() < Date.now();
}

async function sendReceivedSms(reservationId: string, phone: string, classLabel: string) {
  const { url, serviceKey } = getSupabaseAdmin();
  let result: Record<string, unknown> = { ok: false, error: 'send failed' };
  try {
    const response = await fetch(`${url}/functions/v1/solapi-reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ messageType: 'reservation_received', phone, values: { class_date: classLabel } }),
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
        message_type: 'reservation_received',
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
    const classes = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=id,class_date,start_time,end_time,is_public,status`);
    const classRow = Array.isArray(classes) ? classes[0] : null;
    if (!classRow || classRow.is_public !== true || classRow.status === 'hidden') {
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
    if (isPastClassKst(String(classRow.class_date), String(classRow.start_time))) {
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

    // 접수 확인 문자(베스트 에포트 — 실패해도 신청 자체는 성공으로 응답).
    const classLabel = formatSchedule(String(classRow.class_date), String(classRow.start_time), String(classRow.end_time));
    if (reservation && reservation.id) await sendReceivedSms(String(reservation.id), phone, classLabel);

    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
```

- [ ] **Step 2: config.toml 갱신** — `[functions.admin-auth]` 블록을 지우고 아래 추가:

```toml
[functions.submit-reservation]
verify_jwt = false
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/functions/submit-reservation/index.ts supabase/config.toml
git commit -m "feat: 공개 신청 엔드포인트 submit-reservation 신설 (검증·중복차단·접수 문자)"
```

### Task 3: admin-reservations — 취소 문자·bulkApprove 가드·skip 로그·재발송 확장

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: 취소 분기에서 취소 안내 문자 발송**

`updateReservation`의 `else if (updated.reservation_status === 'cancelled')` 분기를 아래로 교체(미결제 마감은 위 expired 분기에서 이미 별도 문자):

```ts
    } else if (updated.reservation_status === 'cancelled') {
      const info = await classInfo(String(updated.class_id || ''));
      await notify(password, updated, 'reservation_cancelled', { class_date: info.label, place: info.place });
      await cancelScheduledFollowups(password, String(updated.id));
    } else if (...
```

- [ ] **Step 2: bulkApprove 재클릭 가드**

`bulkApprove`에서 remaining 계산과 candidates 필터를 교체. 이미 결제 안내를 받은 payment_target은 다시 후보로 잡지 않고(중복 문자 방지), 남은 자리 계산에서도 차감(초과 승인 방지):

```ts
  const confirmedCount = rows.filter((r) => r.reservation_status === 'confirmed' || r.payment_status === 'paid').length;
  // 이미 결제 안내 대상인 인원은 자리를 점유 중 — 재클릭 시 중복 문자/초과 승인 방지.
  const paymentTargetCount = rows.filter((r) => r.reservation_status === 'payment_target').length;
  const remaining = Math.max(capacity - confirmedCount - paymentTargetCount, 0);
  const candidates = rows.filter((r) =>
    r.reservation_status !== 'confirmed' && r.payment_status !== 'paid'
    && r.reservation_status !== 'payment_target'
    && r.reservation_status !== 'cancelled' && r.reservation_status !== 'no_show'
  );
```

- [ ] **Step 3: scheduleFollowups 과거시각 skip을 로그로 남기기**

`scheduleFollowups`에서 시각이 지나 예약하지 않는 경우를 message_logs에 skipped로 기록(현황판에 '제외'로 표시되도록). 리마인드/복습 각각:

```ts
  const reminder = kstReminderSchedule(info.class_date);
  if (!done.has('class_reminder')) {
    if (reminder && reminder.atMs > now) {
      await notify(password, reservation, 'class_reminder', { class_date: info.label, place: info.place }, reminder.scheduledDate);
    } else {
      // 발송 시각이 이미 지남 — 조용히 빠뜨리지 않고 skipped로 기록해 현황판에 노출.
      await logMessage(String(reservation.id), 'class_reminder', String(reservation.phone || ''), { ok: false, skipped: true, reason: '예약 발송 시각이 이미 지남' });
    }
  }
  const review = kstReviewSchedule(info.class_date, info.end_time);
  if (!done.has('review_material')) {
    if (review && review.atMs > now) {
      await notify(password, reservation, 'review_material', { class_date: info.label, place: info.place }, review.scheduledDate);
    } else {
      await logMessage(String(reservation.id), 'review_material', String(reservation.phone || ''), { ok: false, skipped: true, reason: '예약 발송 시각이 이미 지남' });
    }
  }
```

- [ ] **Step 4: RESENDABLE_TYPES 확장**

```ts
const RESENDABLE_TYPES = new Set(['reservation_received', 'payment 안내', 'seat_opened', 'payment_completed', 'class_reminder', 'review_material', 'reservation_cancelled']);
```

`resendMessage`의 즉시형 분기는 기존 그대로 동작(reservation_received/reservation_cancelled는 payment_url 없이 class_date·place만 전달 — 템플릿에 {place}가 없으면 그냥 무시됨).

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 취소 안내 문자·일괄승인 재클릭 가드·리마인드 skip 로그"
```

### Task 4: admin-auth 죽은 코드 제거

**Files:**
- Delete: `supabase/functions/admin-auth/index.ts`
- Modify: `admin.html` (참조 제거)

- [ ] **Step 1: 함수 디렉터리 삭제** — `git rm -r supabase/functions/admin-auth`
- [ ] **Step 2: admin.html에서 참조 제거** — `const authEndpoint = 'supabase/functions/admin-auth';` 줄 삭제, `window.__adminEndpoints = { authEndpoint, ... }` → `{ adminReservationsEndpoint, solapiEndpoint }`로.
- [ ] **Step 3: 커밋** — `git commit -m "refactor: 미사용 admin-auth 함수 제거 (admin은 매 요청 비밀번호 검증 방식)"`

### Task 5: index.html — 폼 개편 + 수업정보 동적화 + 폴백 제거

**Files:**
- Modify: `index.html`
- Delete: `data/classes.json`

- [ ] **Step 1: 모달 폼 개편** — 이메일 라벨 삭제. 동의 체크박스를 제출 버튼 위에 추가:

```html
<label class="flex items-start gap-2 text-sm text-ink-700">
  <input type="checkbox" name="privacy_consent" required class="mt-1 h-4 w-4" />
  <span>개인정보 수집·이용에 동의합니다. (이름·휴대폰 번호는 수업 예약 확인과 안내 문자 발송에만 사용하며, 수업 종료 후 파기합니다)</span>
</label>
```

- [ ] **Step 2: submitReservationToSupabase를 submit-reservation 호출로 교체** (함수명 유지 — 테스트 계약):

```js
async function submitReservationToSupabase(payload) {
  var supabaseUrl = window.SUPABASE_URL || '';
  var supabaseAnonKey = window.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    window.__lastReservationPayload = payload;
    return { ok: true, demo: true };
  }
  var response = await fetch(supabaseUrl + '/functions/v1/submit-reservation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: supabaseAnonKey, authorization: 'Bearer ' + supabaseAnonKey },
    body: JSON.stringify(payload)
  });
  var result = await response.json().catch(function () { return {}; });
  if (!response.ok || result.ok === false) {
    var err = new Error(result.error || 'reservation submit failed');
    err.serverMessage = result.error;
    throw err;
  }
  return { ok: true };
}
```

제출 핸들러에서 payload에 `privacy_consent: true` 변환(`payload.privacy_consent = payload.privacy_consent === 'on'`), 성공 문구 "예약 신청이 접수되었습니다. 접수 확인 문자를 보내드립니다.", 실패 시 `error.serverMessage`가 있으면 그대로 표시(중복 신청 안내 등).

- [ ] **Step 3: 수업 정보 섹션 동적화** — "다음 원데이 수업" dd에 `id="next-class-schedule"`, "현재 신청 현황" dd에 `id="next-class-availability"`, "장소" dd에 `id="next-class-place"` 부여. 하드코딩 텍스트는 로딩 전 기본값 "일정 확인 중"으로. `renderScheduleFromClasses` 끝에서 호출하는 함수 추가:

```js
function koreanScheduleLabel(item) {
  var parts = item.date.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  function half(t) {
    var h = Number(t.slice(0, 2)), m = Number(t.slice(3, 5));
    var ampm = h < 12 ? '오전' : '오후';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return ampm + ' ' + h12 + '시' + (m ? ' ' + m + '분' : '');
  }
  var label = Number(parts[1]) + '월 ' + Number(parts[2]) + '일(' + dow + ') ' + half(item.start_time);
  if (item.end_time) label += '~' + half(item.end_time);
  return label;
}

function renderNextClassInfo() {
  var scheduleEl = document.getElementById('next-class-schedule');
  var availabilityEl = document.getElementById('next-class-availability');
  var placeEl = document.getElementById('next-class-place');
  if (!scheduleEl) return;
  var upcoming = (window.__publicClasses || []).filter(function (c) { return !isPastClass(c); })
    .sort(function (a, b) { return (a.date + a.start_time) < (b.date + b.start_time) ? -1 : 1; });
  var next = upcoming[0];
  if (!next) {
    scheduleEl.textContent = '새 일정 오픈 준비 중';
    if (availabilityEl) availabilityEl.textContent = '새 일정이 열리면 달력에서 신청할 수 있습니다';
    return;
  }
  scheduleEl.textContent = koreanScheduleLabel(next);
  if (availabilityEl) availabilityEl.textContent = '예약 가능 인원 ' + availableOf(next) + '명 · 대기 인원 ' + next.waitlist_count + '명';
  if (placeEl && next.place) placeEl.textContent = next.place;
}
```

(`normalizeClass`에 `place: item.place` 필드 추가 필요.) 정원 행은 "6명 (소규모)" 정적 유지(가격·준비물과 같은 고정 정보).

- [ ] **Step 4: 폴백 제거** — `loadClasses`에서 `data/classes.json` fetch 제거. Supabase 실패 시 throw하고, `.catch`에서 달력 영역에 "일정을 불러오지 못했습니다. 잠시 후 새로고침해 주세요." 표시(`calendar-empty` 요소 재사용 + 텍스트 교체). `git rm data/classes.json`.

- [ ] **Step 5: 커밋** — `git commit -m "feat: 신청 폼 개편(동의·이메일 제거·서버 검증) + 수업 정보 동적화 + 낡은 폴백 제거"`

### Task 6: admin.html — 이메일 컬럼 제거·메모 편집·현황판/힌트 갱신

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 이메일 컬럼 제거** — thead `<th>이메일</th>` 삭제, 행 템플릿 `r.email` td 삭제, 빈 상태 colspan 13→12.

- [ ] **Step 2: 메모 편집** — 메모 td를 버튼으로:

```html
<td class="p-3"><button type="button" data-memo-edit="${escapeHtml(r.id)}" class="text-left underline decoration-dotted">${escapeHtml(r.admin_memo || '메모 추가')}</button></td>
```

reservation-rows 클릭 위임에 추가:

```js
document.getElementById('reservation-rows').addEventListener('click', async (event) => {
  const memoButton = event.target.closest('[data-memo-edit]');
  if (!memoButton) return;
  const reservationId = memoButton.dataset.memoEdit;
  const row = adminData.reservations.find((r) => r.id === reservationId);
  const memo = window.prompt('관리자 메모', (row && row.admin_memo) || '');
  if (memo === null) return;
  try {
    await callAdminApi('updateReservation', { reservationId, updates: { admin_memo: memo } });
    await loadAdminData();
  } catch (error) {
    document.getElementById('admin-message').textContent = `메모 저장 실패: ${error.message}`;
  }
});
```

(주의: 기존 change 리스너와 별개의 click 리스너. 메모만 갱신하는 updateReservation은 상태 분기 조건에 안 걸리므로 문자 발송 부작용 없음 — 단 updates에 admin_memo만 보낼 것.)

**Step 2 주의:** updateReservation 서버 분기는 `updated`(전체 row)의 현재 상태를 보므로, 메모만 바꿔도 그 사람이 payment_target 상태면 결제 안내 문자가 재발송된다! 서버 수정 필요: 상태 분기를 "이번 updates에 reservation_status 또는 payment_status가 포함된 경우"에만 타도록 가드:

```ts
  const statusChanged = 'reservation_status' in safeUpdates || 'payment_status' in safeUpdates;
  if (updated && statusChanged) { ... 기존 분기 ... }
```

이 가드는 Task 3에서 admin-reservations 수정 시 함께 반영한다.

- [ ] **Step 3: 일괄 승인 힌트 보정** — renderReservations에서:

```js
const paymentReady = classItem ? Number(classItem.payment_ready_count || 0) : 0;
const remaining = Math.max(capacity - confirmed - paymentReady, 0);
```

힌트 문구도 `→ 선착순 ${remaining}명 결제 안내 대상(이미 안내된 ${paymentReady}명 제외), 나머지 자동 대기`.

- [ ] **Step 4: 현황판 행 갱신** — MESSAGE_STATUS_ROWS 교체:

```js
const MESSAGE_STATUS_ROWS = [
  { label: '예약 신청 완료 문자', type: 'reservation_received' },
  { label: '결제 안내 문자', type: 'payment 안내' },
  { label: '여석 안내 문자', type: 'seat_opened' },
  { label: '결제 완료 문자', type: 'payment_completed' },
  { label: '수업 전 리마인드 문자', type: 'class_reminder' },
  { label: '수업 후 복습 자료 문자', type: 'review_material' },
  { label: '예약 취소 안내 문자', type: 'reservation_cancelled' },
  { label: '복습 영상 안내 문자', type: null, fixed: '수동 발송' },
];
```

- [ ] **Step 5: 커밋** — `git commit -m "feat: 어드민 메모 편집·이메일 컬럼 제거·일괄승인 힌트/현황판 갱신"`

### Task 7: schema.sql + 라이브 DB 마이그레이션 SQL

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: anon insert 정책 제거 + unique 인덱스 추가** — schema.sql에서 `"anon can create reservation"` 정책 블록을 아래 주석+인덱스로 교체:

```sql
-- 예약 신청은 submit-reservation Edge Function(service_role) 경유만 허용한다.
-- (과거의 anon 직접 insert 정책은 제거됨 — 검증·중복차단·접수 문자를 서버에서 일원화)

-- 같은 수업에 같은 번호의 활성 신청(취소/불참 제외)은 1건만 — 중복 신청 DB 차원 차단.
create unique index if not exists reservations_active_unique
  on public.reservations (class_id, phone)
  where reservation_status not in ('cancelled', 'no_show');
```

- [ ] **Step 2: 라이브 적용 SQL을 progress.md '다음에 할 일'에 기록** (사용자가 SQL Editor에서 실행):

```sql
drop policy if exists "anon can create reservation" on public.reservations;
create unique index if not exists reservations_active_unique
  on public.reservations (class_id, phone)
  where reservation_status not in ('cancelled', 'no_show');
```

(주의: 기존 테스트 데이터에 같은 수업·같은 번호 중복이 있으면 인덱스 생성이 실패하므로, 테스트 데이터 정리 후 실행.)

- [ ] **Step 3: 커밋** — `git commit -m "feat: 스키마 — anon insert 정책 제거, 활성 예약 unique 인덱스"`

### Task 8: 계약 테스트 갱신

**Files:**
- Modify: `tests/test_static_pages.py`

- [ ] **Step 1: 깨지는 계약 수정**
  - `test_homepage_adds...`: `data/classes.json`·`name="email"` assertIn 삭제 → `assertNotIn('name="email"', html)`, `assertIn('privacy_consent', html)`, `assertIn('submit-reservation', html)`, `assertNotIn('/rest/v1/reservations', html)` 추가.
  - `test_class_info_shows_next_one_day_class_schedule`: 하드코딩 날짜/인원 assertIn 제거 → `assertIn('id="next-class-schedule"', html)`, `assertIn('id="next-class-availability"', html)`, `assertIn('renderNextClassInfo', html)`, `assertNotIn('6월 6일(토)', html)`, `assertNotIn('대기 인원 14명', html)`.
  - `test_classes_json_exists_for_public_calendar` 삭제.
  - `test_admin_page...`: `supabase/functions/admin-auth` assertIn 삭제, `assertNotIn('admin-auth', html)` 추가. 이메일 컬럼 제거 확인 `assertNotIn('<th class="p-3">이메일</th>', html)`.
  - `test_supabase_schema...`: admin-auth 읽기 제거(ADMIN_PASSWORD_HASH·digest 검증은 admin-reservations로 대체), `assertIn('예약 취소 안내 문자', solapi)` 추가, schema에 `assertIn('reservations_active_unique', schema)`·`assertNotIn('anon can create reservation', schema)` 추가.
  - `test_message_status_dashboard`: `assertIn("자동발송 안 함", admin)` → `assertIn("reservation_received", admin)`·`assertIn("reservation_cancelled", admin)`.

- [ ] **Step 2: 신규 계약 테스트 추가**

```python
    def test_public_submit_reservation_function(self):
        fn = read_page("supabase/functions/submit-reservation/index.ts")
        html = read_page("index.html")

        # 서버 검증·중복차단·접수 문자
        self.assertIn("privacy_consent", fn)
        self.assertIn("^010\\d{8}$", fn)
        self.assertIn("reservation_status=not.in.(cancelled,no_show)", fn)
        self.assertIn("reservation_received", fn)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)
        # 프론트는 함수 호출만, 직접 insert 금지
        self.assertIn("functions/v1/submit-reservation", html)
        self.assertNotIn("rest/v1/reservations", html)
        # 메모 편집 + 일괄승인 가드
        admin = read_page("admin.html")
        self.assertIn("data-memo-edit", admin)
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        self.assertIn("paymentTargetCount", admin_fn)
        self.assertIn("reservation_cancelled", admin_fn)
        self.assertIn("statusChanged", admin_fn)
```

- [ ] **Step 3: 전체 실행** — `python3 -m unittest tests.test_static_pages -v` 전부 PASS 확인.
- [ ] **Step 4: 커밋** — `git commit -m "test: 1차 구조 개선 계약 테스트 갱신"`

### Task 9: 문서 갱신 + 마무리

**Files:**
- Modify: `CLAUDE.md`, `docs/progress.md`

- [ ] **Step 1: CLAUDE.md** — 페이지 흐름(submit-reservation 경유, 폴백 제거), 배포 명령(admin-auth 삭제·submit-reservation 추가), 주의사항(classes.json 항목 제거) 갱신.
- [ ] **Step 2: progress.md** — 이번 작업 내용, 배포 필요 목록(함수 3개 배포 + SQL 2줄 실행), 마지막 갱신 날짜.
- [ ] **Step 3: 전체 테스트 재실행 후 push** — `git add -A && git commit -m "docs: 1차 구조 개선 반영" && git push`

### Task 10: 배포 (사용자 토큰 필요)

- [ ] supabase login (이전 토큰 폐기됨 — 새 PAT 필요, 사용자 액션)
- [ ] `supabase functions deploy submit-reservation --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt`
- [ ] `supabase functions deploy solapi-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt`
- [ ] `supabase functions deploy admin-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt`
- [ ] (선택) `supabase functions delete admin-auth --project-ref vjoxzbxcylqyhxezxiuj`
- [ ] SQL Editor에서 Task 7 마이그레이션 SQL 실행 (테스트 데이터 정리 후)
- [ ] 스모크: submit-reservation에 잘못된 번호 POST → 400, 정상 신청 → 200 + 접수 문자
