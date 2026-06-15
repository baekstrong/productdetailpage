# 관리자 월간 캘린더 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 "수업 일정 등록/관리"를 월간 캘린더로 보강 — 캘린더에서 등록/수정/삭제, 목록 표 행 클릭으로 수업 선택(신청현황 갱신), 중복된 "일정 선택" 드롭다운 제거.

**Architecture:** `admin.html` 프론트만 수정. 인라인 등록 폼을 등록/수정 공용 모달로 옮기고, 월간 캘린더를 신규 추가한다. 드롭다운 기반 `selectedClassId()`를 모듈 변수 `currentClassId` 기반으로 교체하고, 목록 표 행 클릭이 그 변수를 갱신한다. Edge Function·DB·캘린더 동기화 백엔드는 전부 기존 그대로 재사용.

**Tech Stack:** 정적 HTML + 인라인 vanilla JS(ES module), Tailwind CDN, Python unittest 계약 테스트. 새 의존성 없음.

**참고:** 설계 문서 `docs/superpowers/specs/2026-06-15-admin-calendar-ui-design.md`.

---

## 파일 구조

- Modify: `admin.html` — (1) 일정 선택 드롭다운 섹션 제거 + `currentClassId` 상태화, (2) 등록/수정 모달 추가 + 인라인 폼 제거, (3) 월간 캘린더 추가, (4) 목록 표 행 선택·하이라이트
- Modify: `tests/test_static_pages.py` — 계약 테스트 갱신
- Modify: `docs/progress.md` — 반영

기존 백엔드 호출은 그대로: `createClass`/`updateClass`/`deleteClass`(+force)/`list`/`bulkApprove`/`resendMessage`. statusLabels·escapeHtml·callAdminApi·loadAdminData·renderSummary·renderReservations·renderMessageStatus 등 기존 함수 재사용.

---

### Task 1: 선택 상태를 드롭다운에서 모듈 변수로 교체 + 일정 선택 섹션 제거

**Files:** Modify `admin.html`

- [ ] **Step 1: 일정 선택 섹션(드롭다운) 마크업 제거**

`admin.html`에서 아래 `<section>`(헤더 "일정 선택" + `class-filter`/`class-date-display`/`class-status-display` + 그 안의 `refresh-button`)을 통째로 삭제한다. 단 **새로고침 기능은 상단 sticky 바(`refresh-button-top`)에 이미 있으므로** 이 섹션 안의 `refresh-button`도 함께 사라진다. (현재 `refresh-button`/`refresh-button-top` 둘 다 핸들러에 연결돼 있으니, 다음 Step에서 죽은 참조를 정리한다.)

삭제 대상(헤더 "일정 선택"이 있는 `<section class="rounded-3xl bg-white p-6 text-slate-900">` … `</section>` 블록 전체).

- [ ] **Step 2: 죽은 참조 정리 + currentClassId 상태 도입**

`let adminData = { ... }` 선언 부근에 추가:

```js
    let currentClassId = '';
```

`selectedClassId()` 함수를 교체:

```js
    function selectedClassId() {
      return currentClassId;
    }
```

`renderClasses`/`classOptionHtml` 함수 정의를 삭제(드롭다운 전용). `renderSummary`에서 `class-date-display`/`class-status-display`에 값을 넣던 두 줄을 삭제(요소가 사라졌으므로). `refresh-button`(상단 sticky의 `refresh-button-top`만 남김) addEventListener와 `class-filter` change addEventListener 두 줄을 삭제.

- [ ] **Step 3: loadAdminData/renderAdminData의 선택 보존을 currentClassId로**

`renderAdminData`에서 드롭다운 value 보정 로직을 교체:

```js
    function renderAdminData() {
      const allIds = adminData.classes.map((c) => c.class_id);
      // 선택값이 없거나 사라진 수업이면 기본값을 가장 가까운 다음 일정으로(없으면 첫 수업).
      if (!currentClassId || !allIds.includes(currentClassId)) {
        const upcoming = upcomingClasses(adminData.classes);
        currentClassId = (upcoming[0] || adminData.classes[0] || {}).class_id || '';
      }
      const currentClass = adminData.classes.find((item) => item.class_id === selectedClassId());
      renderSummary(currentClass);
      renderReservations(reservationsForSelectedClass(), currentClass);
      renderMessageStatus();
      renderClassManager(adminData.classes); // 선택 하이라이트 갱신 위해 표도 다시 렌더
    }
```

`loadAdminData`에서 `renderClasses(adminData.classes)` 호출과 `previousClassId`로 `class-filter.value`를 복원하던 블록을 삭제(이미 `currentClassId`가 모듈 변수라 보존됨). `renderClassManager(adminData.classes)`와 `renderAdminData()` 호출은 유지.

- [ ] **Step 4: 계약 테스트 통과 확인 + 커밋**

Run: `python3 -m unittest tests.test_static_pages -v` (이 시점에 `class-filter` 검사 테스트가 있으면 Task 5에서 함께 갱신 — 우선 깨지면 다음 Task로). 

```bash
git add admin.html
git commit -m "refactor: 일정 선택 드롭다운 제거, 선택 상태를 currentClassId 모듈 변수로"
```

### Task 2: 등록/수정 공용 모달 + 인라인 폼 제거

**Files:** Modify `admin.html`

- [ ] **Step 1: 모달 마크업 추가**

`admin-app` 섹션 안(맨 끝 `</section>` 직전 또는 적절한 위치)에 모달을 추가:

```html
      <div id="class-modal" class="hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div data-class-modal-close class="absolute inset-0 bg-slate-900/50"></div>
        <div role="dialog" aria-modal="true" class="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
          <div class="flex items-start justify-between">
            <h3 id="class-modal-title" class="text-xl font-extrabold">수업 등록</h3>
            <button type="button" data-class-modal-close class="text-2xl text-slate-400 hover:text-slate-700">✕</button>
          </div>
          <form id="class-modal-form" class="mt-5 grid gap-3 sm:grid-cols-2">
            <input type="hidden" id="modal-class-id" />
            <label class="grid gap-1 text-xs font-bold text-slate-600">수업 날짜
              <input id="modal-class-date" type="date" required class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="grid gap-1 text-xs font-bold text-slate-600">정원
              <input id="modal-class-capacity" type="number" min="1" value="6" required class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="grid gap-1 text-xs font-bold text-slate-600">시작 시간
              <input id="modal-class-start" type="time" required value="13:00" class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="grid gap-1 text-xs font-bold text-slate-600">종료 시간
              <input id="modal-class-end" type="time" required value="16:00" class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="grid gap-1 text-xs font-bold text-slate-600">장소
              <input id="modal-class-place" type="text" value="근력학교 고대점" class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="grid gap-1 text-xs font-bold text-slate-600">상태
              <select id="modal-class-status" class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal">
                <option value="open">예약 가능</option>
                <option value="waitlist">대기 가능</option>
                <option value="closed">마감</option>
                <option value="hidden">숨김</option>
              </select></label>
            <label class="flex items-center gap-2 pt-5 text-xs font-bold text-slate-600 sm:col-span-2">
              <input id="modal-class-public" type="checkbox" checked class="h-4 w-4" /> 고객 페이지에 공개</label>
            <div class="mt-2 flex items-center gap-2 sm:col-span-2">
              <button type="submit" class="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white">저장</button>
              <button id="modal-class-delete" type="button" class="hidden rounded-xl bg-red-100 px-5 py-3 font-bold text-red-700">삭제</button>
            </div>
          </form>
          <p id="class-modal-message" class="mt-3 text-sm text-slate-500"></p>
        </div>
      </div>
```

- [ ] **Step 2: 인라인 등록 폼 제거**

기존 `<form id="class-create-form">…</form>`과 `<p id="class-form-message">`를 삭제. (Step 1 마크업 정리 시 짝 안 맞는 잉여 `</div>`가 있으면 함께 정리해 `<table>` 직전 구조를 깔끔히.)

- [ ] **Step 3: 모달 열기/닫기/저장/삭제 함수**

기존 `fillClassForm`/`resetClassForm`/`class-create-form` submit 핸들러/`class-reset-button` 핸들러를 삭제하고 아래로 대체:

```js
    function openClassModal(mode, classItem) {
      const modal = document.getElementById('class-modal');
      const isEdit = mode === 'edit' && classItem;
      document.getElementById('class-modal-title').textContent = isEdit ? '수업 수정' : '수업 등록';
      document.getElementById('modal-class-id').value = isEdit ? classItem.class_id : '';
      document.getElementById('modal-class-date').value = isEdit ? (classItem.class_date || '') : ((classItem && classItem.class_date) || '');
      document.getElementById('modal-class-start').value = isEdit ? String(classItem.start_time || '').slice(0, 5) : '13:00';
      document.getElementById('modal-class-end').value = isEdit ? String(classItem.end_time || '').slice(0, 5) : '16:00';
      document.getElementById('modal-class-capacity').value = isEdit ? (classItem.capacity || 6) : 6;
      document.getElementById('modal-class-place').value = isEdit ? (classItem.place || '근력학교 고대점') : '근력학교 고대점';
      document.getElementById('modal-class-status').value = isEdit ? (classItem.status || 'open') : 'open';
      document.getElementById('modal-class-public').checked = isEdit ? classItem.is_public !== false : true;
      document.getElementById('modal-class-delete').classList.toggle('hidden', !isEdit);
      document.getElementById('class-modal-message').textContent = '';
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
    function closeClassModal() {
      document.getElementById('class-modal').classList.add('hidden');
      document.body.style.overflow = '';
    }
    document.querySelectorAll('[data-class-modal-close]').forEach((el) => el.addEventListener('click', closeClassModal));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeClassModal(); });

    document.getElementById('class-modal-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.getElementById('class-modal-message');
      const classPayload = {
        class_date: document.getElementById('modal-class-date').value,
        start_time: document.getElementById('modal-class-start').value,
        end_time: document.getElementById('modal-class-end').value,
        capacity: Number(document.getElementById('modal-class-capacity').value),
        place: document.getElementById('modal-class-place').value,
        status: document.getElementById('modal-class-status').value,
        is_public: document.getElementById('modal-class-public').checked,
      };
      const editId = document.getElementById('modal-class-id').value;
      message.textContent = editId ? '수업을 수정하는 중입니다.' : '수업을 등록하는 중입니다.';
      try {
        if (editId) await callAdminApi('updateClass', { classId: editId, updates: classPayload });
        else await callAdminApi('createClass', { class: classPayload });
        closeClassModal();
        await loadAdminData();
      } catch (error) {
        message.textContent = `처리 실패: ${error.message}`;
      }
    });

    document.getElementById('modal-class-delete').addEventListener('click', async () => {
      const classId = document.getElementById('modal-class-id').value;
      if (!classId) return;
      const message = document.getElementById('class-modal-message');
      if (!window.confirm('이 수업 일정을 삭제하면 해당 예약 신청도 함께 삭제됩니다. 삭제할까요?')) return;
      try {
        try {
          await callAdminApi('deleteClass', { classId });
        } catch (deleteError) {
          if (String(deleteError.message || '').includes('결제 완료 예약')) {
            if (!window.confirm(`${deleteError.message}\n\n그래도 삭제하시겠습니까? (결제 완료 고객의 신청 기록도 함께 삭제됩니다)`)) return;
            await callAdminApi('deleteClass', { classId, force: true });
          } else { throw deleteError; }
        }
        closeClassModal();
        await loadAdminData();
      } catch (error) {
        message.textContent = `삭제 실패: ${error.message}`;
      }
    });
```

- [ ] **Step 4: 목록 표 관리 버튼이 모달을 열도록 수정**

기존 `class-rows` click 위임 핸들러에서 `action === 'edit'` 분기를 `fillClassForm`+스크롤 대신 모달로:

```js
        if (action === 'edit') {
          if (classItem) openClassModal('edit', classItem);
          return;
        }
```

(toggle-public·delete 분기는 기존 그대로 유지 — delete는 force 방어 로직 포함된 현재 코드 유지.)

- [ ] **Step 5: 계약 테스트 + 커밋**

Run: `python3 -m unittest tests.test_static_pages -v` (Task 5에서 함께 갱신)

```bash
git add admin.html
git commit -m "feat: 수업 등록/수정 공용 모달 (인라인 폼 제거, 표 수정 버튼이 모달 오픈)"
```

### Task 3: 월간 캘린더

**Files:** Modify `admin.html`

- [ ] **Step 1: 캘린더 마크업 추가**

"수업 일정 등록/관리" 섹션에서 목록 표(`<div class="mt-6 overflow-x-auto">…</div>`) **위에** 캘린더 + "새 수업 등록" 버튼을 추가:

```html
        <div class="mt-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div class="flex items-center justify-between gap-2">
            <p id="admin-cal-title" class="text-lg font-extrabold"></p>
            <div class="flex items-center gap-2">
              <button id="admin-cal-prev" type="button" class="rounded-lg bg-white px-3 py-2 font-bold ring-1 ring-slate-200">‹</button>
              <button id="admin-cal-today" type="button" class="rounded-lg bg-white px-3 py-2 text-sm font-bold ring-1 ring-slate-200">오늘</button>
              <button id="admin-cal-next" type="button" class="rounded-lg bg-white px-3 py-2 font-bold ring-1 ring-slate-200">›</button>
              <button id="admin-cal-add" type="button" class="rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white">＋ 새 수업</button>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-bold text-slate-400">
            <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
          </div>
          <div id="admin-cal-body" class="mt-1 grid grid-cols-7 gap-1"></div>
          <p class="mt-2 text-xs text-slate-400">빈 날짜를 누르면 등록, 수업을 누르면 수정/삭제 창이 열립니다.</p>
        </div>
```

- [ ] **Step 2: 캘린더 렌더 함수**

`renderClassManager` 근처에 추가:

```js
    let adminCalView = null;
    function adminCalToday() { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; }
    function adminCalDefaultView() {
      const up = upcomingClasses(adminData.classes)[0];
      if (up && up.class_date) { const p = up.class_date.split('-'); return { year: Number(p[0]), month: Number(p[1]) - 1 }; }
      return adminCalToday();
    }
    function adminCalBadge(c) {
      const time = `${String(c.start_time || '').slice(0, 5)}~${String(c.end_time || '').slice(0, 5)}`;
      const tone = c.status === 'hidden' ? 'bg-slate-200 text-slate-500'
        : c.status === 'closed' ? 'bg-rose-100 text-rose-700'
        : c.status === 'waitlist' ? 'bg-amber-100 text-amber-700'
        : 'bg-blue-100 text-blue-700';
      const dim = c.is_public === false ? ' opacity-50' : '';
      const counts = `확정 ${c.confirmed_count || 0}·가능 ${c.available_count || 0}·대기 ${c.waitlist_count || 0}`;
      return `<button type="button" data-cal-class="${escapeHtml(c.class_id)}" class="block w-full rounded-md ${tone}${dim} px-1 py-0.5 text-left text-[10px] leading-tight">`
        + `<span class="block font-bold">${escapeHtml(time)}</span>`
        + `<span class="block">${escapeHtml(statusLabels[c.status] || c.status)}</span>`
        + `<span class="block text-[9px]">${escapeHtml(counts)}</span></button>`;
    }
    function renderAdminCalendar() {
      const body = document.getElementById('admin-cal-body');
      if (!body) return;
      if (!adminCalView) adminCalView = adminCalDefaultView();
      const { year, month } = adminCalView;
      document.getElementById('admin-cal-title').textContent = `${year}년 ${month + 1}월`;
      const byDate = {};
      adminData.classes.forEach((c) => { (byDate[c.class_date] = byDate[c.class_date] || []).push(c); });
      const pad2 = (n) => (n < 10 ? '0' : '') + n;
      const startDow = new Date(year, month, 1).getDay();
      const days = new Date(year, month + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < startDow; i += 1) cells.push('<div class="min-h-[84px] rounded-lg bg-white/40"></div>');
      for (let d = 1; d <= days; d += 1) {
        const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        const items = (byDate[dateStr] || []).slice().sort((a, b) => (String(a.start_time) < String(b.start_time) ? -1 : 1));
        cells.push(`<div data-cal-date="${dateStr}" class="min-h-[84px] cursor-pointer rounded-lg bg-white p-1 ring-1 ring-slate-200 hover:ring-blue-300">`
          + `<div class="text-right text-[11px] font-bold text-slate-500">${d}</div>`
          + `<div class="mt-0.5 flex flex-col gap-0.5">${items.map(adminCalBadge).join('')}</div></div>`);
      }
      while (cells.length % 7 !== 0) cells.push('<div class="min-h-[84px] rounded-lg bg-white/40"></div>');
      body.innerHTML = cells.join('');
    }
```

`renderAdminData` 안에서 `renderClassManager(adminData.classes);` 다음 줄에 `renderAdminCalendar();` 추가.

- [ ] **Step 3: 캘린더 클릭·이동 핸들러**

```js
    document.getElementById('admin-cal-body').addEventListener('click', (event) => {
      const classBtn = event.target.closest('[data-cal-class]');
      if (classBtn) {
        const c = adminData.classes.find((x) => x.class_id === classBtn.dataset.calClass);
        if (c) openClassModal('edit', c);
        return;
      }
      const dateCell = event.target.closest('[data-cal-date]');
      if (dateCell) openClassModal('create', { class_date: dateCell.dataset.calDate });
    });
    function adminCalShift(delta) {
      const base = adminCalView || adminCalDefaultView();
      const d = new Date(base.year, base.month + delta, 1);
      adminCalView = { year: d.getFullYear(), month: d.getMonth() };
      renderAdminCalendar();
    }
    document.getElementById('admin-cal-prev').addEventListener('click', () => adminCalShift(-1));
    document.getElementById('admin-cal-next').addEventListener('click', () => adminCalShift(1));
    document.getElementById('admin-cal-today').addEventListener('click', () => { adminCalView = adminCalToday(); renderAdminCalendar(); });
    document.getElementById('admin-cal-add').addEventListener('click', () => openClassModal('create', {}));
```

- [ ] **Step 4: 계약 테스트 + 커밋**

```bash
git add admin.html
git commit -m "feat: 관리자 월간 캘린더 (칸에 시간·상태·신청현황, 빈날짜→등록·수업→수정)"
```

### Task 4: 목록 표 행 선택 + 하이라이트

**Files:** Modify `admin.html`

- [ ] **Step 1: renderClassManager 행에 선택 표시·data 속성**

`renderClassManager`의 행 템플릿 `<tr ...>`에 선택 하이라이트와 `data-select-class`를 추가한다. 기존 `<tr class="border-b border-slate-100 align-middle${past ? ' bg-slate-50 text-slate-400' : ''}">` 를:

```js
        const selected = c.class_id === currentClassId;
        const rowClass = `cursor-pointer border-b border-slate-100 align-middle${past ? ' bg-slate-50 text-slate-400' : ''}${selected ? ' bg-blue-50 ring-2 ring-blue-300' : ''}`;
        return `
          <tr data-select-class="${escapeHtml(c.class_id)}" class="${rowClass}">
```

(나머지 셀·관리 버튼은 그대로.)

- [ ] **Step 2: 행 클릭 → 선택, 버튼은 분리**

기존 `class-rows` click 핸들러 맨 위에서 버튼이 아니면 행 선택을 처리:

```js
    document.getElementById('class-rows').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-class-action]');
      if (!button) {
        const row = event.target.closest('[data-select-class]');
        if (row) setSelectedClass(row.dataset.selectClass);
        return;
      }
      // ...기존 버튼 처리(edit/toggle-public/delete)...
    });
```

`setSelectedClass`를 selectedClassId 근처에 정의:

```js
    function setSelectedClass(id) {
      currentClassId = id;
      renderAdminData();
    }
```

- [ ] **Step 3: 계약 테스트 + 커밋**

```bash
git add admin.html
git commit -m "feat: 목록 표 행 클릭으로 수업 선택 + 선택 행 하이라이트"
```

### Task 5: 계약 테스트 갱신

**Files:** Modify `tests/test_static_pages.py`

- [ ] **Step 1: 깨지는 기존 계약 확인·수정**

`test_admin_page_implements_supabase_protected_schedule_and_status_table` 등에서 `data-class-form`/`class-filter` 같은 제거된 요소를 검사하면 삭제. 신규 검증 추가(새 테스트 메서드 `test_admin_calendar_ui`):

```python
    def test_admin_calendar_ui(self):
        html = read_page("admin.html")
        # 월간 캘린더
        self.assertIn('id="admin-cal-body"', html)
        self.assertIn("renderAdminCalendar", html)
        self.assertIn("data-cal-date", html)
        self.assertIn("data-cal-class", html)
        # 등록/수정 모달
        self.assertIn('id="class-modal"', html)
        self.assertIn("openClassModal", html)
        self.assertIn("modal-class-date", html)
        # 표 행 선택
        self.assertIn("data-select-class", html)
        self.assertIn("setSelectedClass", html)
        self.assertIn("currentClassId", html)
        # 드롭다운/인라인 폼 제거
        self.assertNotIn('id="class-filter"', html)
        self.assertNotIn('id="class-create-form"', html)
```

`test_admin_page_implements...`에서 `self.assertIn("data-class-form", html)` 줄이 있으면 삭제(섹션 제거됨). `대기 순번 조정` 등 다른 검사는 유지.

- [ ] **Step 2: 전체 실행**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 전부 PASS.

- [ ] **Step 3: 커밋**

```bash
git add tests/test_static_pages.py
git commit -m "test: 관리자 월간 캘린더 UI 계약 테스트 갱신"
```

### Task 6: 문서 + 마무리

**Files:** Modify `docs/progress.md`

- [ ] **Step 1: progress.md** — 관리자 캘린더 UI 추가 반영, 마지막 갱신일.
- [ ] **Step 2: 전체 테스트 후 push**

```bash
python3 -m unittest tests.test_static_pages -v
git add -A && git commit -m "docs: 관리자 월간 캘린더 UI 반영" && git push
```

---

## Self-Review

- **스펙 커버리지:** 캘린더(Task 3) / 등록·수정 모달(Task 2) / 표 행 선택·하이라이트(Task 4) / 드롭다운 제거·selectedClassId 교체(Task 1) / 칸 신청현황(Task 3 adminCalBadge) / 테스트(Task 5) — 모두 매핑.
- **플레이스홀더:** 없음(코드 전문 포함). 단 Task 1 Step 1·Task 2 Step 2의 "기존 블록 삭제"는 구현자가 admin.html을 읽고 정확한 범위를 식별해야 함(파일 통합 특성상 불가피) — 삭제 대상 식별자(`id`)를 명시했다.
- **타입 일관성:** `currentClassId`(문자열), `selectedClassId()`→`currentClassId`, `setSelectedClass(id)`, `openClassModal(mode, classItem)`, `renderAdminCalendar()`, `adminCalView={year,month}` — 전 Task에서 동일 사용.
- **의존성 순서:** Task 1(상태·드롭다운 제거)→2(모달)→3(캘린더, openClassModal 사용)→4(표 선택, setSelectedClass 사용)→5(테스트). 순서대로 실행.
