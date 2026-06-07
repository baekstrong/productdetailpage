# 문자 발송 현황판 + 재발송 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** admin "문자 자동 예약" 정적 목록을, 선택 일정의 실제 발송 현황판(발송완료/예약완료/제외 명단 + 재발송 버튼)으로 바꾼다.

**Architecture:** `admin-reservations`의 `list`가 `message_logs`를 함께 내려주고, `admin.html`이 선택 일정 예약자 기준으로 종류별 상태를 집계해 표시한다. 재발송은 `resendMessage` 액션이 기존 `notify` 경로를 재사용한다.

**Tech Stack:** Supabase Edge Function(Deno/TS), 정적 HTML+vanilla JS, Python 계약 테스트.

**참고:** 설계 `docs/superpowers/specs/2026-06-07-message-status-dashboard-design.md`

---

## 파일 구조

- `supabase/functions/admin-reservations/index.ts` — `listAdminData`에 message_logs 추가; `resendMessage` 액션 + serve 디스패치.
- `admin.html` — list 응답의 message_logs 저장; "문자 자동 예약" 섹션을 동적 현황판으로 교체; 집계/렌더/재발송 핸들러; `renderAdminData`에 연결.
- `tests/test_static_pages.py` — 현황판 계약 테스트.

**테스트 전략:** Edge Function 로직은 계약(문자열) 테스트로, JS 집계 순수함수는 계약 테스트로 존재 강제 + 수동 스모크. 정적 페이지 계약 테스트가 게이트.

---

## Task 1: admin-reservations — list 응답에 message_logs 포함

**Files:** Modify `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: listAdminData가 message_logs를 조회·반환**

`listAdminData`에서 `reservations`를 가져오는 줄 다음에 message_logs 조회를 추가하고, 마지막 return에 포함한다.

`const reservations = await supabaseFetch('reservations?select=*&order=created_at.asc');` 다음 줄에 추가:

```ts
  const messageLogs = await supabaseFetch('message_logs?select=reservation_id,message_type,status&order=created_at.asc');
```

그리고 함수 마지막 return:

```ts
  return { ok: true, classes: summary, reservations: reservationRows };
```

를 다음으로 교체:

```ts
  return { ok: true, classes: summary, reservations: reservationRows, message_logs: Array.isArray(messageLogs) ? messageLogs : [] };
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 관리자 list 응답에 message_logs 포함(발송 현황판용)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: admin-reservations — resendMessage 액션

**Files:** Modify `supabase/functions/admin-reservations/index.ts`

- [ ] **Step 1: resendMessage 함수 추가**

`updateReservation` 함수 정의 바로 위에 추가한다:

```ts
// 재발송 가능한 자동 문자 종류 화이트리스트.
const RESENDABLE_TYPES = new Set(['payment 안내', 'seat_opened', 'payment_completed', 'class_reminder', 'review_material']);

// 현황판에서 미발송자에게 해당 종류 문자를 재발송한다.
async function resendMessage(classId: string, messageType: string, reservationIds: string[], password: string) {
  if (!RESENDABLE_TYPES.has(messageType)) throw new Error('invalid messageType');
  if (!Array.isArray(reservationIds) || !reservationIds.length) return { ok: true, sent: 0 };
  const info = await classInfo(classId);
  let sent = 0;
  for (const id of reservationIds) {
    const rows = await supabaseFetch(`reservations?id=eq.${encodeURIComponent(id)}&select=*`);
    const reservation = Array.isArray(rows) ? rows[0] : rows;
    if (!reservation) continue;
    if (messageType === 'class_reminder' || messageType === 'review_material') {
      const sched = messageType === 'class_reminder'
        ? kstReminderSchedule(info.class_date)
        : kstReviewSchedule(info.class_date, info.end_time);
      if (!sched || sched.atMs <= Date.now()) continue; // 예약 시각이 이미 지났으면 재예약 불가
      await notify(password, reservation, messageType, { class_date: info.label, place: info.place }, sched.scheduledDate);
    } else {
      const values: Record<string, string> = { class_date: info.label, place: info.place };
      if (messageType === 'payment 안내' || messageType === 'seat_opened') values.payment_url = PAYMENT_LINK;
      await notify(password, reservation, messageType, values);
    }
    sent += 1;
  }
  return { ok: true, sent };
}
```

- [ ] **Step 2: serve에 디스패치 추가**

`serve` 안, `if (action === 'updateReservation') { ... }` 블록 바로 다음에 추가한다:

```ts
    if (action === 'resendMessage') {
      return jsonResponse(await resendMessage(
        String(body.classId || ''),
        String(body.messageType || ''),
        Array.isArray(body.reservationIds) ? body.reservationIds.map(String) : [],
        password,
      ));
    }
```

- [ ] **Step 3: Deno 문법 확인 (가능 시)**

Run: `deno check supabase/functions/admin-reservations/index.ts` — 에러 없으면 OK. (deno 없으면 skip, 배포 시 확인.)

- [ ] **Step 4: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts
git commit -m "feat: 현황판 미발송자 재발송 액션(resendMessage) 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: admin.html — list 응답의 message_logs 저장

**Files:** Modify `admin.html`

- [ ] **Step 1: adminData에 messageLogs 추가**

`loadAdminData`에서 다음 줄

```js
      adminData = { classes: result.classes || [], reservations: result.reservations || [] };
```

을 다음으로 교체:

```js
      adminData = { classes: result.classes || [], reservations: result.reservations || [], messageLogs: result.message_logs || [] };
```

또한 파일 상단의 초기값 `let adminData = { classes: [], reservations: [] };` 를 다음으로 교체:

```js
    let adminData = { classes: [], reservations: [], messageLogs: [] };
```

- [ ] **Step 2: 커밋**

```bash
git add admin.html
git commit -m "feat: 관리자 화면에 message_logs 데이터 보관(현황판용)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: admin.html — "문자 자동 예약" 섹션을 동적 현황판으로 교체

**Files:** Modify `admin.html`

- [ ] **Step 1: 섹션 마크업 교체**

다음 블록 전체

```html
      <section class="rounded-3xl bg-white p-6 text-slate-900">
        <h2 class="text-xl font-extrabold">문자 자동 예약</h2>
        <p class="mt-2 text-sm text-slate-500">예약 단계별로 고객에게 보낼 안내 문자 항목입니다. 실제 문자 자동 발송 연동은 준비 중입니다.</p>
        <ul class="mt-4 grid gap-2 text-sm md:grid-cols-2">
          <li>예약 신청 완료 문자</li><li>결제 안내 문자</li><li>여석 안내 문자</li><li>결제 완료 문자</li><li>수업 전 리마인드 문자</li><li>수업 후 복습 자료 문자</li><li>복습 영상 안내 문자는 수동 발송</li>
        </ul>
      </section>
```

을 다음으로 교체:

```html
      <section class="rounded-3xl bg-white p-6 text-slate-900">
        <h2 class="text-xl font-extrabold">문자 발송 현황</h2>
        <p class="mt-2 text-sm text-slate-500">선택한 일정 기준으로 단계별 안내 문자의 발송/예약 여부를 보여줍니다. 일부가 누락되면 제외 명단과 재발송 버튼이 나타납니다.</p>
        <div id="message-status-rows" class="mt-4"></div>
      </section>
```

- [ ] **Step 2: 계약 테스트 실행(아직 신규 테스트 전이라 기존 통과만 확인)**

Run: `python3 -m unittest tests.test_static_pages`
Expected: OK (12). (이 단계에서 깨지면 다른 곳을 잘못 건드린 것.)

- [ ] **Step 3: 커밋**

```bash
git add admin.html
git commit -m "feat: '문자 자동 예약' 정적 목록을 발송 현황판 컨테이너로 교체

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: admin.html — 집계/렌더/재발송 로직

**Files:** Modify `admin.html`

- [ ] **Step 1: 집계·렌더 함수 추가**

`renderAdminData` 함수 정의 바로 위에 추가한다:

```js
    // 현황판 행 정의 — type이 null이면 fixed 문구만 표시(자동발송 없음/수동).
    const MESSAGE_STATUS_ROWS = [
      { label: '예약 신청 완료 문자', type: null, fixed: '자동발송 안 함' },
      { label: '결제 안내 문자', type: 'payment 안내' },
      { label: '여석 안내 문자', type: 'seat_opened' },
      { label: '결제 완료 문자', type: 'payment_completed' },
      { label: '수업 전 리마인드 문자', type: 'class_reminder' },
      { label: '수업 후 복습 자료 문자', type: 'review_material' },
      { label: '복습 영상 안내 문자', type: null, fixed: '수동 발송' },
    ];

    function bestLogStatus(statuses) {
      if (statuses.includes('sent')) return 'sent';
      if (statuses.includes('scheduled')) return 'scheduled';
      if (statuses.includes('cancelled')) return 'cancelled';
      return 'missing'; // failed / skipped / cancel_failed / 기타
    }

    // 선택 일정 예약자 기준으로 특정 문자 종류의 발송 상태를 집계.
    function summarizeMessageStatus(type, reservations, logs) {
      const resById = {};
      reservations.forEach((r) => { resById[r.id] = r; });
      const byRes = {};
      (logs || []).forEach((log) => {
        if (log.message_type !== type) return;
        if (!resById[log.reservation_id]) return;
        (byRes[log.reservation_id] = byRes[log.reservation_id] || []).push(log.status);
      });
      const sent = [], scheduled = [], missing = [];
      Object.keys(byRes).forEach((rid) => {
        const best = bestLogStatus(byRes[rid]);
        const name = resById[rid] ? resById[rid].applicant_name : '';
        if (best === 'sent') sent.push({ id: rid, name });
        else if (best === 'scheduled') scheduled.push({ id: rid, name });
        else if (best === 'cancelled') { /* 취소는 행에서 완전 제외 */ }
        else missing.push({ id: rid, name });
      });
      return { sent, scheduled, missing };
    }

    function statusRowHtml(label, summaryHtml, actionHtml) {
      return `<div data-message-status class="flex items-center justify-between gap-3 border-b border-slate-100 py-2">
        <span class="text-sm font-bold text-slate-700">${escapeHtml(label)}</span>
        <span class="flex items-center gap-3 text-sm">${summaryHtml}${actionHtml || ''}</span>
      </div>`;
    }

    function renderMessageStatus() {
      const container = document.getElementById('message-status-rows');
      if (!container) return;
      const reservations = reservationsForSelectedClass();
      const logs = adminData.messageLogs || [];
      container.innerHTML = MESSAGE_STATUS_ROWS.map((row) => {
        if (!row.type) {
          return statusRowHtml(row.label, `<span class="text-slate-400">${escapeHtml(row.fixed)}</span>`, '');
        }
        const { sent, scheduled, missing } = summarizeMessageStatus(row.type, reservations, logs);
        const n = sent.length + scheduled.length + missing.length;
        let summary, action = '';
        if (n === 0) {
          summary = '<span class="text-slate-400">발송 내역 없음</span>';
        } else if (missing.length === 0) {
          if (scheduled.length === 0) summary = `<span class="font-bold text-emerald-700">✅ 전체 발송 완료 (${sent.length}명)</span>`;
          else if (sent.length === 0) summary = `<span class="font-bold text-sky-700">📅 전체 예약 완료 (${scheduled.length}명)</span>`;
          else summary = `<span class="font-bold text-emerald-700">발송 ${sent.length}명 · 예약 ${scheduled.length}명 (총 ${n}명)</span>`;
        } else {
          const names = missing.map((m) => escapeHtml(m.name)).join(', ');
          summary = `<span class="font-bold text-amber-700">발송 완료 (제외: ${names})</span>`;
          action = `<button type="button" data-resend-type="${escapeHtml(row.type)}" class="rounded-lg bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-700">재발송 ${missing.length}명</button>`;
        }
        return statusRowHtml(row.label, summary, action);
      }).join('');
    }

    async function handleResend(type) {
      const reservations = reservationsForSelectedClass();
      const ids = summarizeMessageStatus(type, reservations, adminData.messageLogs || []).missing.map((m) => m.id);
      if (!ids.length) return;
      if (!window.confirm(`미발송 ${ids.length}명에게 재발송할까요?`)) return;
      const msg = document.getElementById('admin-message');
      if (msg) msg.textContent = '재발송 중입니다.';
      try {
        await callAdminApi('resendMessage', { classId: selectedClassId(), messageType: type, reservationIds: ids });
        await loadAdminData();
        if (msg) msg.textContent = '재발송했습니다.';
      } catch (error) {
        if (msg) msg.textContent = `재발송 실패: ${error.message}`;
      }
    }
```

- [ ] **Step 2: renderAdminData에서 현황판 렌더 호출**

`renderAdminData` 함수의 마지막 줄

```js
      renderReservations(reservationsForSelectedClass(), currentClass);
    }
```

을 다음으로 교체:

```js
      renderReservations(reservationsForSelectedClass(), currentClass);
      renderMessageStatus();
    }
```

- [ ] **Step 3: 재발송 버튼 이벤트 위임 등록**

`document.getElementById('class-filter').addEventListener('change', renderAdminData);` 줄 바로 다음에 추가:

```js
    document.getElementById('message-status-rows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-resend-type]');
      if (button) handleResend(button.dataset.resendType);
    });
```

- [ ] **Step 4: 계약 테스트 실행**

Run: `python3 -m unittest tests.test_static_pages`
Expected: OK (12).

- [ ] **Step 5: 커밋**

```bash
git add admin.html
git commit -m "feat: 문자 발송 현황 집계·표시·재발송 로직

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 계약 테스트 추가

**Files:** Modify `tests/test_static_pages.py`

- [ ] **Step 1: 신규 테스트 작성**

`StaticPageTests` 클래스 끝(마지막 메서드 다음, `if __name__` 위)에 추가:

```python
    def test_message_status_dashboard(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")

        # 현황판 마크업/함수
        self.assertIn("문자 발송 현황", admin)
        self.assertIn('id="message-status-rows"', admin)
        self.assertIn("summarizeMessageStatus", admin)
        self.assertIn("renderMessageStatus", admin)
        self.assertIn("data-resend-type", admin)
        self.assertIn("자동발송 안 함", admin)
        self.assertIn("수동 발송", admin)
        self.assertIn("제외:", admin)

        # 서버: message_logs 제공 + 재발송 액션
        self.assertIn("message_logs", admin_fn)
        self.assertIn("resendMessage", admin_fn)
        self.assertIn("action === 'resendMessage'", admin_fn)
```

- [ ] **Step 2: 전체 테스트**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 모두 PASS (12 + 1 = 13).

- [ ] **Step 3: 커밋**

```bash
git add tests/test_static_pages.py
git commit -m "test: 문자 발송 현황판 계약 테스트 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: progress.md 갱신 + 푸시

**Files:** Modify `docs/progress.md`

- [ ] **Step 1: 완료 기능에 현황판 추가, 마지막 갱신일 갱신**

"이번까지 완료한 기능"에 다음 bullet을 추가하고(기존 유지), `마지막 갱신`을 2026-06-07로 갱신:

```
- **문자 발송 현황판 + 재발송 — 코드 완료(배포 전)** (`admin.html` + `admin-reservations`)
  - admin `list`가 `message_logs`를 함께 내려주고, 선택 일정 기준으로 종류별 발송/예약/미발송을 집계해 표시.
  - 전원 성공 시 "전체 발송 완료(N명)"/"전체 예약 완료(N명)", 일부 누락 시 "발송 완료(제외: 이름…)" + [재발송 K명] 버튼.
  - 재발송은 `resendMessage` 액션(즉시형 즉시발송 / 예약형 재예약, 과거 시각이면 skip). 분모=보낸 시도 기준.
  - ⚠️ admin-reservations 재배포 필요(`--no-verify-jwt`).
```

- [ ] **Step 2: 커밋·푸시**

```bash
git add -A
git commit -m "docs: progress.md 갱신 (문자 발송 현황판+재발송 구현)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push
```

---

## Task 8: 배포 (운영자 확인 후)

> admin-reservations만 재배포하면 된다(admin.html은 GitHub Pages 자동). 운영자에게 배포 진행 여부 확인 후 실행.

- [ ] **Step 1: 배포**

```bash
supabase functions deploy admin-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt
```

- [ ] **Step 2: 스모크 — 틀린 비번 재발송 → 401**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://vjoxzbxcylqyhxezxiuj.supabase.co/functions/v1/admin-reservations" \
  -H "content-type: application/json" \
  -H "apikey: sb_publishable_U7ezBE8WmH2X2W9EnHx7Rw_q8t8h3HV" \
  -H "authorization: Bearer sb_publishable_U7ezBE8WmH2X2W9EnHx7Rw_q8t8h3HV" \
  --data '{"action":"resendMessage","classId":"x","messageType":"payment 안내","reservationIds":[],"password":"wrong"}'
```

Expected: `401`.
