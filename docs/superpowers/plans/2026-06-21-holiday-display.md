# 공휴일 표시(대체공휴일 포함) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객·관리자 캘린더에 한국 공휴일(대체공휴일 포함)과 일요일을 빨강+이름으로 표시한다. 공휴일에도 수업 등록은 기존대로 자유롭게 가능(표시 전용).

**Architecture:** 공휴일 날짜→이름 맵을 단일 파일 `holidays.js`(전역 `window.KR_HOLIDAYS` + `window.holidayName`)에 두고, `index.html`·`admin.html`이 `<script src>`로 로드해 각 캘린더 렌더에서 참조한다. 백엔드·DB 무변경, 정적 파일이라 push만으로 반영.

**Tech Stack:** 정적 HTML + 인라인 vanilla JS, Tailwind CDN, Python `unittest` 계약 테스트.

## Global Constraints

- 외부 의존성·번들러·`node_modules` 추가 금지. 순수 vanilla JS 한 파일(`var`/`function` 또는 기존 파일 스타일 따름).
- 시크릿을 클라이언트에 노출 금지(anon key만). 고객 화면(`index.html`)에 개인 대기 순번·내부 운영 용어 노출 금지.
- 공휴일 표시는 **표시 전용** — 수업 등록 로직(날짜 제한)은 건드리지 않는다.
- 커밋 메시지는 한글. 계약 테스트(`python3 -m unittest tests.test_static_pages`)는 항상 통과.
- 모바일 칸이 좁으므로(고객 캘린더 ~44px) 공휴일명은 `text-[9px]`·`leading-tight`·`truncate`/`overflow-hidden`로 칸을 넘지 않게.
- 공휴일 날짜는 **공식 발표 확정값**(계산 금지). 아래 데이터는 2026·2027 확정값이며 요일까지 교차검증됨.

---

### Task 1: `holidays.js` 데이터 파일

**Files:**
- Create: `holidays.js`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Produces: 전역 `window.KR_HOLIDAYS`(객체: `'YYYY-MM-DD' → 공휴일명`), `window.holidayName(dateStr)`(문자열 반환, 없으면 `''`). 키 형식은 캘린더가 쓰는 `YYYY-MM-DD`와 동일.

- [ ] **Step 1: 계약 테스트 작성**

`tests/test_static_pages.py`의 `StaticPageTests` 클래스에 추가:

```python
    def test_holidays_data_file(self):
        hol = read_page("holidays.js")
        self.assertIn("KR_HOLIDAYS", hol)
        self.assertIn("holidayName", hol)
        self.assertIn("'2026-01-01': '신정'", hol)
        self.assertIn("'2026-05-05': '어린이날'", hol)
        self.assertIn("'2026-09-25': '추석'", hol)
        self.assertIn("대체공휴일", hol)
        self.assertIn("'2027-02-09': '대체공휴일'", hol)
        self.assertIn("'2027-12-25': '성탄절'", hol)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_holidays_data_file -v`
Expected: FAIL (holidays.js 없음 → FileNotFoundError)

- [ ] **Step 3: `holidays.js` 생성**

파일 `holidays.js`를 다음 내용으로 생성:

```js
// holidays.js — 한국 법정공휴일 + 대체공휴일 (고객·관리자 캘린더 공용).
// 매년 새 연도 공휴일을 추가한다. 정부 임시공휴일도 발표되면 한 줄 추가한다.
// 날짜는 공식 발표 확정값(직접 계산 금지). 키 형식은 캘린더의 YYYY-MM-DD와 동일.
window.KR_HOLIDAYS = {
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날',
  '2026-02-17': '설날',
  '2026-02-18': '설날',
  '2026-03-01': '삼일절',
  '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일',
  '2026-09-24': '추석',
  '2026-09-25': '추석',
  '2026-09-26': '추석',
  '2026-09-28': '대체공휴일',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날',
  '2027-02-07': '설날',
  '2027-02-08': '설날',
  '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절',
  '2027-08-16': '대체공휴일',
  '2027-09-14': '추석',
  '2027-09-15': '추석',
  '2027-09-16': '추석',
  '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일',
  '2027-10-09': '한글날',
  '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절',
  '2027-12-27': '대체공휴일'
};
window.holidayName = function (dateStr) {
  return (window.KR_HOLIDAYS && window.KR_HOLIDAYS[dateStr]) || '';
};
```

- [ ] **Step 4: 테스트 통과 + 문법 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_holidays_data_file -v` → PASS
Run: `node --check holidays.js` → 오류 없음
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 5: 커밋**

```bash
git add holidays.js tests/test_static_pages.py
git commit -m "공휴일 데이터: holidays.js (2026~2027 법정공휴일+대체공휴일)"
```

---

### Task 2: `index.html` 고객 캘린더 공휴일 표시

**Files:**
- Modify: `index.html:18`(스크립트 로드), `:251-253`(요일헤더), `:744-754`(dayCellHtml)
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `window.holidayName(dateStr)`(Task 1).
- Produces: 고객 캘린더가 공휴일·일요일 날짜를 빨강으로, 공휴일명을 칸에 표시.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms` 메서드(안에서 `html = read_page("index.html")` 정의됨) 끝부분에 추가:

```python
        # 공휴일 표시
        self.assertIn('src="holidays.js"', html)
        self.assertIn("holidayName", html)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms -v` → FAIL

- [ ] **Step 3: `holidays.js` 로드 추가**

`index.html:18` 현재:
```html
  <script src="https://cdn.tailwindcss.com"></script>
```
다음으로 변경(바로 아래에 한 줄 추가):
```html
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="holidays.js"></script>
```

- [ ] **Step 4: 요일헤더 일요일 빨강**

`index.html:252` 현재:
```html
            <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
```
다음으로 변경(일요일만 빨강):
```html
            <div class="text-red-500">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
```

- [ ] **Step 5: `dayCellHtml`에 공휴일/일요일 색 + 이름**

`index.html:744-754`의 `dayCellHtml` 함수 전체를 다음으로 교체:

```js
      function dayCellHtml(y, m, d, isToday) {
        var items = classesByDate[ymd(y, m, d)] || [];
        var dateStr = ymd(y, m, d);
        var dow = new Date(y, m, d).getDay();
        var hol = (typeof window.holidayName === 'function') ? window.holidayName(dateStr) : '';
        var isRed = !!hol || dow === 0;
        var numColor = isRed ? 'text-red-500' : (items.length ? 'text-ink-900' : 'text-ink-400');
        var head = isToday
          ? '<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-xs font-extrabold text-white">' + d + '</span>'
          : '<span class="text-sm font-bold ' + numColor + '">' + d + '</span>';
        var holLabel = hol ? '<div class="text-[9px] leading-tight text-red-500 truncate">' + hol + '</div>' : '';
        if (!items.length) {
          return '<div class="calendar-day rounded-xl bg-white ring-1 ring-ink-200/60 p-2 text-right overflow-hidden' + (isToday ? ' ring-2 ring-red-400' : '') + '">' + head + holLabel + '</div>';
        }
        return '<div class="calendar-day rounded-xl bg-white ring-1 ring-ink-200/60 p-1.5 text-left flex flex-col gap-1 overflow-hidden' + (isToday ? ' ring-2 ring-red-400' : '') + '">'
          + '<div class="text-right leading-none">' + head + holLabel + '</div>' + items.map(classAnchorHtml).join('') + '</div>';
      }
```

(변경점: `dateStr`/`dow`/`hol`/`isRed`/`numColor` 계산 추가, `head`의 날짜 색을 `numColor`로, 빈 칸에 `overflow-hidden` 추가, `holLabel`을 head 뒤에 삽입.)

- [ ] **Step 6: 테스트 통과 + 문법 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms -v` → PASS
`index.html`의 인라인 캘린더 스크립트를 `node --check`로 검증(또는 편집 부위 괄호/따옴표 짝 확인).
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 7: 커밋**

```bash
git add index.html tests/test_static_pages.py
git commit -m "index: 고객 캘린더 공휴일·일요일 빨강 표시 + 공휴일명"
```

---

### Task 3: `admin.html` 관리자 캘린더 공휴일 표시

**Files:**
- Modify: `admin.html:8`(스크립트 로드), `:59`(요일헤더), `:505-510`(renderAdminCalendar 셀 생성)
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `window.holidayName(dateStr)`(Task 1).
- Produces: 관리자 캘린더가 공휴일·일요일 날짜를 빨강으로, 공휴일명을 칸에 표시.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_admin_calendar_ui` 메서드(안에서 `html = read_page("admin.html")` 정의됨)에 추가:

```python
        self.assertIn('src="holidays.js"', html)
        self.assertIn("holidayName", html)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_admin_calendar_ui -v` → FAIL

- [ ] **Step 3: `holidays.js` 로드 추가**

`admin.html:8` 현재:
```html
  <script src="https://cdn.tailwindcss.com"></script>
```
다음으로 변경:
```html
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="holidays.js"></script>
```

- [ ] **Step 4: 요일헤더 일요일 빨강**

`admin.html:59` 현재:
```html
            <div>일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
```
다음으로 변경:
```html
            <div class="text-red-500">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div>토</div>
```

- [ ] **Step 5: `renderAdminCalendar` 날짜 셀에 공휴일/일요일 색 + 이름**

`admin.html:505-510`의 날짜 셀 생성 `for` 루프를 다음으로 교체. 현재:
```js
      for (let d = 1; d <= days; d += 1) {
        const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        const items = (byDate[dateStr] || []).slice().sort((a, b) => (String(a.start_time) < String(b.start_time) ? -1 : 1));
        cells.push(`<div data-cal-date="${dateStr}" class="min-h-[84px] cursor-pointer rounded-lg bg-white p-1 ring-1 ring-slate-200 hover:ring-blue-300">`
          + `<div class="text-right text-[11px] font-bold text-slate-500">${d}</div>`
          + `<div class="mt-0.5 flex flex-col gap-0.5">${items.map(adminCalBadge).join('')}</div></div>`);
      }
```

다음으로 변경:
```js
      for (let d = 1; d <= days; d += 1) {
        const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
        const items = (byDate[dateStr] || []).slice().sort((a, b) => (String(a.start_time) < String(b.start_time) ? -1 : 1));
        const dow = new Date(year, month, d).getDay();
        const hol = (typeof window.holidayName === 'function') ? window.holidayName(dateStr) : '';
        const numColor = (hol || dow === 0) ? 'text-red-500' : 'text-slate-500';
        const holLabel = hol ? `<div class="text-[9px] leading-tight text-red-500 truncate">${hol}</div>` : '';
        cells.push(`<div data-cal-date="${dateStr}" class="min-h-[84px] cursor-pointer overflow-hidden rounded-lg bg-white p-1 ring-1 ring-slate-200 hover:ring-blue-300">`
          + `<div class="flex items-start justify-between gap-1"><div class="text-[11px] font-bold ${numColor}">${d}</div>${holLabel}</div>`
          + `<div class="mt-0.5 flex flex-col gap-0.5">${items.map(adminCalBadge).join('')}</div></div>`);
      }
```

(변경점: `dow`/`hol`/`numColor`/`holLabel` 계산 추가, 날짜 숫자 줄을 `flex` 한 줄로 바꿔 우측에 공휴일명 배치, 셀에 `overflow-hidden` 추가.)

- [ ] **Step 6: 테스트 통과 + 문법 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_admin_calendar_ui -v` → PASS
`admin.html`의 인라인 `<script type="module">`를 `node --check`로 검증(또는 편집 부위 괄호/따옴표 짝 확인).
전체: `python3 -m unittest tests.test_static_pages`

- [ ] **Step 7: 커밋**

```bash
git add admin.html tests/test_static_pages.py
git commit -m "admin: 관리자 캘린더 공휴일·일요일 빨강 표시 + 공휴일명"
```

---

### Task 4: 통합 검증 + 문서

**Files:**
- Modify: `docs/progress.md`
- Test: 전체 계약 테스트 + 브라우저 렌더

- [ ] **Step 1: 전체 계약 테스트**

Run: `python3 -m unittest tests.test_static_pages -v` → 전부 PASS

- [ ] **Step 2: 브라우저 렌더 검증(모바일·데스크탑)**

로컬 서버(`python3 -m http.server 8123`)를 띄우고 Playwright로 확인:
- `index.html`을 iPhone 폭(390×844)·데스크탑(1100)으로 열어 캘린더를 **2026년 5월**로 이동 → 5/5(어린이날)·5/24·5/25(부처님오신날·대체)가 빨강+이름으로 뜨고, 일요일이 빨강이며, 공휴일명이 칸을 넘치지 않는지(모바일) 확인.
- `admin.html`도 같은 달로 확인(공휴일명이 날짜 옆에, 기존 수업 배지와 겹치지 않는지).
- 회귀: 공휴일 아닌 평일·기존 수업 배지가 그대로인지.
홀리데이가 없는 달도 정상 렌더되는지 확인. 끝나면 서버 종료, 임시 스크린샷 삭제.

- [ ] **Step 3: progress.md 갱신**

`docs/progress.md` 상단에 `🆕 공휴일 표시(2026-06-21)` 한 줄 요약 추가(holidays.js 신규, index·admin 캘린더 공휴일·일요일 빨강+이름, 2026~2027 데이터, **정적 파일이라 push만으로 반영**, 등록 제한 없음). `마지막 갱신` 날짜 갱신.

- [ ] **Step 4: progress.md 커밋 + 전체 push**

```bash
git add docs/progress.md
git commit -m "docs: 공휴일 표시 기능 진행상황 반영"
git push
```

---

## Self-Review

**Spec coverage:** 단일 공유 파일 holidays.js → Task 1 ✓ / 고객 표시 → Task 2 ✓ / 관리자 표시 → Task 3 ✓ / 일요일 빨강 → Task 2·3 ✓ / 공휴일명 표시 → Task 2·3 ✓ / 모바일 폭 처리 → Task 2·3(text-[9px]/truncate/overflow-hidden)·Task 4 검증 ✓ / 등록 제한 없음 → 등록 로직 미변경(전 태스크 해당 없음) ✓ / 테스트 → 각 태스크 ✓. 누락 없음.

**Type consistency:** `window.KR_HOLIDAYS`(객체), `window.holidayName(dateStr)→string`이 Task 1 정의와 Task 2·3 사용에서 동일. 날짜 키 `YYYY-MM-DD`가 index `ymd()`·admin `dateStr`(`${year}-${pad2(month+1)}-${pad2(d)}`) 출력과 일치. 색 클래스(`text-red-500`)·공휴일명 라벨(`text-[9px] leading-tight text-red-500 truncate`)을 양쪽에서 동일하게 사용.

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. 공휴일 데이터는 확정값(2026·2027). "적절히" 류 없음.
