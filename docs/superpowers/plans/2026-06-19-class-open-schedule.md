# 예약 오픈 예약 + 달력 미리보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수업 등록 시 "예약 오픈 일시"를 지정해 그 전에는 예약을 막고(비공개), 지정 시각 이후 자동으로 예약을 열며, 원하면 오픈 전에도 달력에 "예약 오픈 예정"으로 미리 노출한다.

**Architecture:** `classes`에 컬럼 2개(`open_at`, `preview_before_open`)를 추가하고, 공개 판정을 DB(뷰·RLS의 `now()` 비교)에서 자동 처리한다. Edge Function 2개와 정적 페이지 2개가 새 필드를 읽고 쓴다. 별도 cron 없이 매 조회마다 판정된다.

**Tech Stack:** Supabase Postgres(뷰·RLS), Deno/TypeScript Edge Functions, 정적 HTML + 인라인 vanilla JS, Python `unittest` 계약 테스트.

## Global Constraints

- 외부 의존성·번들러·`node_modules` 추가 금지. 프론트는 인라인 vanilla JS(`var`/`function` 혼용 스타일 유지).
- 시크릿은 클라이언트에 절대 노출 금지. `index.html`/`admin.html`에는 anon publishable key만.
- 고객 화면(`index.html`)에 개인 대기 순번, 내부 운영 용어("백관장"·"Solapi"·"관리자" 등) 노출 금지(계약 테스트가 강제).
- 결제 완료 전에는 "수업 확정" 표기 금지.
- 운영 DB에는 `schema.sql` 전체 재실행 금지. 컬럼은 `add column if not exists`, 정책/뷰는 `drop ... if exists` 후 재생성으로 안전 적용.
- 모든 커밋 메시지는 한글. 계약 테스트(`python3 -m unittest tests.test_static_pages`)는 항상 통과.
- 시각은 KST 기준 입력. `datetime-local`(타임존 없음) ↔ `timestamptz` 변환 시 `+09:00`을 명시한다.

---

### Task 1: DB 스키마 — 컬럼·뷰·RLS

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Produces: `classes.open_at`(timestamptz, nullable), `classes.preview_before_open`(boolean default false). 뷰 `class_reservation_summary`에 `open_at`, `preview_before_open`, `is_open`(boolean 계산) 컬럼. 뷰·RLS는 `(open_at is null or open_at <= now() or preview_before_open = true)`인 공개 수업만 anon에 노출.

- [ ] **Step 1: 계약 테스트 작성 (실패 확인용)**

`tests/test_static_pages.py`의 `StaticPageTests` 클래스에 추가:

```python
    def test_class_open_schedule_schema(self):
        schema = read_page("supabase/schema.sql")
        # 새 컬럼
        self.assertIn("open_at timestamptz", schema)
        self.assertIn("preview_before_open boolean not null default false", schema)
        self.assertIn("add column if not exists open_at", schema)
        self.assertIn("add column if not exists preview_before_open", schema)
        # 뷰: is_open 계산 + 오픈/미리보기 노출 조건
        self.assertIn("as is_open", schema)
        self.assertIn("c.open_at is null or c.open_at <= now() or c.preview_before_open", schema)
        # RLS도 같은 조건
        self.assertIn("open_at is null or open_at <= now() or preview_before_open", schema)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_class_open_schedule_schema -v`
Expected: FAIL (`open_at timestamptz` not found 등)

- [ ] **Step 3: `classes` 테이블 정의에 컬럼 추가**

`supabase/schema.sql`에서 `status text not null default 'open' ...` 줄 바로 다음(`google_event_id text,` 위)에 두 줄 추가. 현재:

```sql
  status text not null default 'open' check (status in ('open', 'waitlist', 'closed', 'hidden')),
  google_event_id text,
```

다음으로 변경:

```sql
  status text not null default 'open' check (status in ('open', 'waitlist', 'closed', 'hidden')),
  open_at timestamptz,
  preview_before_open boolean not null default false,
  google_event_id text,
```

- [ ] **Step 4: 기존 테이블용 `alter add column if not exists` 추가**

`supabase/schema.sql`에서 `alter table public.classes add column if not exists google_event_id text;` 줄 바로 아래에 추가:

```sql
-- 예약 오픈 일시 + 오픈 전 달력 미리보기(기존 테이블 보강).
alter table public.classes add column if not exists open_at timestamptz;
alter table public.classes add column if not exists preview_before_open boolean not null default false;
```

- [ ] **Step 5: 뷰 `class_reservation_summary` 재정의**

`supabase/schema.sql`의 뷰 정의(현재 53~70행)를 다음으로 교체:

```sql
create or replace view public.class_reservation_summary as
select
  c.id as class_id,
  c.class_date,
  c.start_time,
  c.end_time,
  c.place,
  c.capacity,
  c.is_public,
  c.status,
  c.open_at,
  c.preview_before_open,
  (c.open_at is null or c.open_at <= now()) as is_open,
  count(r.id) filter (where (r.reservation_status = 'confirmed' or r.payment_status = 'paid') and r.reservation_status not in ('cancelled', 'no_show')) as confirmed_count,
  greatest(c.capacity - count(r.id) filter (where (r.reservation_status = 'confirmed' or r.payment_status = 'paid') and r.reservation_status not in ('cancelled', 'no_show')), 0) as available_count,
  count(r.id) filter (where r.reservation_status in ('applied', 'waitlisted')) as waitlist_count,
  count(r.id) filter (where r.reservation_status = 'payment_target') as payment_ready_count
from public.classes c
left join public.reservations r on r.class_id = c.id
where c.is_public = true
  and c.status <> 'hidden'
  and (c.open_at is null or c.open_at <= now() or c.preview_before_open = true)
group by c.id;
```

- [ ] **Step 6: RLS 정책 재정의**

`supabase/schema.sql`의 anon select 정책(현재 77~80행)을 다음으로 교체(`drop ... if exists` 후 재생성으로 운영 DB 재적용 안전):

```sql
-- Public homepage can read only public + opened/preview class summaries.
drop policy if exists "public can read open classes" on public.classes;
create policy "public can read open classes"
on public.classes for select
to anon
using (
  is_public = true
  and status <> 'hidden'
  and (open_at is null or open_at <= now() or preview_before_open = true)
);
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_class_open_schedule_schema -v`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add supabase/schema.sql tests/test_static_pages.py
git commit -m "예약 오픈 일시/미리보기: classes 컬럼·뷰·RLS 추가"
```

---

### Task 2: `submit-reservation` — 오픈 전 예약 거부

**Files:**
- Modify: `supabase/functions/submit-reservation/index.ts:130-134`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `classes.open_at`(Task 1).
- Produces: 오픈 전(`open_at` 미래) 신청 시 400 거부, 메시지 `"아직 예약이 시작되지 않은 수업입니다."`

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_public_submit_reservation_function`(266행~) 끝에 추가:

```python
        # 오픈 전(open_at 미래) 수업은 예약 거부
        self.assertIn("open_at", fn)
        self.assertIn("아직 예약이 시작되지 않은 수업입니다", fn)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_public_submit_reservation_function -v`
Expected: FAIL (`open_at` not found)

- [ ] **Step 3: classes select에 `open_at` 추가**

`supabase/functions/submit-reservation/index.ts:130` 현재:

```ts
    const classes = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=id,class_date,start_time,end_time,is_public,status,capacity`);
```

변경:

```ts
    const classes = await supabaseFetch(`classes?id=eq.${encodeURIComponent(classId)}&select=id,class_date,start_time,end_time,is_public,status,capacity,open_at`);
```

- [ ] **Step 4: 오픈 전 거부 추가**

`index.ts:132-134`의 공개/숨김 검사 블록 바로 다음에 추가. 현재:

```ts
    if (!classRow || classRow.is_public !== true || classRow.status === 'hidden') {
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
```

다음으로 변경(블록 아래에 오픈 검사 삽입):

```ts
    if (!classRow || classRow.is_public !== true || classRow.status === 'hidden') {
      return jsonResponse({ ok: false, error: '신청할 수 없는 수업입니다.' }, 400);
    }
    // 예약 오픈 일시가 미래면 아직 신청 불가(달력 미리보기 상태).
    if (classRow.open_at && new Date(String(classRow.open_at)).getTime() > Date.now()) {
      return jsonResponse({ ok: false, error: '아직 예약이 시작되지 않은 수업입니다.' }, 400);
    }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_public_submit_reservation_function -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/submit-reservation/index.ts tests/test_static_pages.py
git commit -m "submit-reservation: 예약 오픈 전 신청 거부"
```

---

### Task 3: `admin-reservations` — 필드 화이트리스트·목록 응답

**Files:**
- Modify: `supabase/functions/admin-reservations/index.ts:175-188`, `:206-219`
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `classes.open_at`, `classes.preview_before_open`(Task 1).
- Produces: `createClass`/`updateClass`가 `open_at`(빈값→null), `preview_before_open`(boolean)을 저장. `listAdminData`의 각 class summary에 `open_at`, `preview_before_open`, `is_open` 포함.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_supabase_schema_and_edge_functions_are_documented`(199행~) 안에서 `admin_fn` 변수 사용 부분에 추가:

```python
        self.assertIn("open_at", admin_fn)
        self.assertIn("preview_before_open", admin_fn)
        self.assertIn("is_open", admin_fn)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_supabase_schema_and_edge_functions_are_documented -v`
Expected: FAIL

- [ ] **Step 3: `CLASS_FIELDS`에 컬럼 추가 + `pickClassFields` 보강**

`supabase/functions/admin-reservations/index.ts:175` 현재:

```ts
const CLASS_FIELDS = ['class_date', 'start_time', 'end_time', 'place', 'capacity', 'is_public', 'status'];
```

변경:

```ts
const CLASS_FIELDS = ['class_date', 'start_time', 'end_time', 'place', 'capacity', 'is_public', 'status', 'preview_before_open'];
```

`pickClassFields`(178~188행)를 다음으로 교체(`open_at`은 "빈값이면 null로 지움"이 필요해 루프 밖에서 특별 처리, `preview_before_open`은 boolean):

```ts
function pickClassFields(input: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of CLASS_FIELDS) {
    if (input[key] === undefined || input[key] === null || input[key] === '') continue;
    if (key === 'capacity') row[key] = Number(input[key]);
    else if (key === 'is_public' || key === 'preview_before_open') row[key] = Boolean(input[key]);
    else row[key] = input[key];
  }
  // open_at은 빈값이면 NULL(즉시 오픈)로 명시 저장 — 화이트리스트 루프와 달리 '지우기'를 허용.
  if ('open_at' in input) row.open_at = input.open_at ? input.open_at : null;
  if (row.status !== undefined && !CLASS_STATUSES.has(String(row.status))) throw new Error('invalid class status');
  return row;
}
```

- [ ] **Step 4: `listAdminData` summary에 필드 추가**

`index.ts:206-219`의 `return { class_id: ... }` 객체에 세 필드 추가. 현재 `status: c.status,` 줄 다음에:

```ts
      is_public: c.is_public,
      status: c.status,
```

다음으로 변경:

```ts
      is_public: c.is_public,
      status: c.status,
      open_at: c.open_at || null,
      preview_before_open: c.preview_before_open === true,
      is_open: c.open_at ? (new Date(String(c.open_at)).getTime() <= Date.now()) : true,
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_supabase_schema_and_edge_functions_are_documented -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/admin-reservations/index.ts tests/test_static_pages.py
git commit -m "admin-reservations: open_at·preview 필드 저장/조회"
```

---

### Task 4: `admin.html` — 등록 모달 필드 + 시각 변환 + 관리자 캘린더 배지

**Files:**
- Modify: `admin.html:172-173`(모달 필드), `:548-560`(openClassModal), `:720-730`(폼 payload), `:479-490`(adminCalBadge)
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: `listAdminData`의 `open_at`/`preview_before_open`/`is_open`(Task 3), `createClass`/`updateClass` payload(Task 3).
- Produces: 모달이 `open_at`(ISO 문자열 또는 null), `preview_before_open`(bool)을 payload에 담아 전송. KST 변환 헬퍼 `openAtToInput(iso)`, `inputToOpenAtIso(localValue)`.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_admin_calendar_ui`(168행~) 안에 추가:

```python
        self.assertIn("modal-class-open-at", html)
        self.assertIn("modal-class-preview", html)
        self.assertIn('type="datetime-local"', html)
        self.assertIn("inputToOpenAtIso", html)
        self.assertIn("openAtToInput", html)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_admin_calendar_ui -v`
Expected: FAIL

- [ ] **Step 3: 모달에 필드 추가**

`admin.html:172-173`의 '고객 페이지에 공개' label 현재:

```html
            <label class="flex items-center gap-2 pt-5 text-xs font-bold text-slate-600 sm:col-span-2">
              <input id="modal-class-public" type="checkbox" checked class="h-4 w-4" /> 고객 페이지에 공개</label>
```

다음으로 변경(예약 오픈 일시 + 미리보기 체크박스 + 안내 추가):

```html
            <label class="grid gap-1 text-xs font-bold text-slate-600 sm:col-span-2">예약 오픈 일시 (비우면 즉시 오픈)
              <input id="modal-class-open-at" type="datetime-local" class="rounded-xl border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label class="flex items-center gap-2 text-xs font-bold text-slate-600 sm:col-span-2">
              <input id="modal-class-preview" type="checkbox" class="h-4 w-4" /> 오픈 전에도 달력에 '예약 오픈 예정'으로 표시</label>
            <label class="flex items-center gap-2 pt-2 text-xs font-bold text-slate-600 sm:col-span-2">
              <input id="modal-class-public" type="checkbox" checked class="h-4 w-4" /> 고객 페이지에 공개(끄면 오픈 일시와 무관하게 무조건 숨김)</label>
```

- [ ] **Step 4: KST 변환 헬퍼 + openClassModal 채우기**

`admin.html`의 `function openClassModal(mode, classItem) {`(548행) 바로 위에 헬퍼 두 개를 추가:

```js
    // timestamptz(ISO) → datetime-local 입력값(KST 벽시계 YYYY-MM-DDTHH:mm)
    function openAtToInput(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
    }
    // datetime-local 입력값(KST로 해석) → ISO 문자열(+09:00). 비면 null.
    function inputToOpenAtIso(localValue) {
      if (!localValue) return null;
      return localValue.slice(0, 16) + ':00+09:00';
    }
```

`openClassModal`의 필드 채우기 블록(552~559행)에서 `modal-class-public` 줄 다음에 추가:

```js
      document.getElementById('modal-class-public').checked = isEdit ? classItem.is_public !== false : true;
      document.getElementById('modal-class-open-at').value = isEdit ? openAtToInput(classItem.open_at) : '';
      document.getElementById('modal-class-preview').checked = isEdit ? classItem.preview_before_open === true : false;
```

- [ ] **Step 5: 폼 제출 payload에 필드 추가**

`admin.html:724-730`의 `classPayload` 객체. 현재:

```js
        class_date: document.getElementById('modal-class-date').value,
        start_time: document.getElementById('modal-class-start').value,
        end_time: document.getElementById('modal-class-end').value,
        capacity: Number(document.getElementById('modal-class-capacity').value),
        place: document.getElementById('modal-class-place').value,
        status: document.getElementById('modal-class-status').value,
        is_public: document.getElementById('modal-class-public').checked,
```

마지막 줄 다음에 두 필드 추가:

```js
        is_public: document.getElementById('modal-class-public').checked,
        open_at: inputToOpenAtIso(document.getElementById('modal-class-open-at').value),
        preview_before_open: document.getElementById('modal-class-preview').checked,
```

- [ ] **Step 6: 관리자 캘린더 배지에 '오픈예정' 표시**

`admin.html:486-490`의 `adminCalBadge`. 현재 `counts` 정의와 return:

```js
      const counts = `확정 ${c.confirmed_count || 0}·가능 ${c.available_count || 0}·대기 ${c.waitlist_count || 0}`;
      return `<button type="button" data-cal-class="${escapeHtml(c.class_id)}" class="block w-full rounded-md ${tone}${dim} px-1 py-0.5 text-left text-[10px] leading-tight">`
        + `<span class="block font-bold">${escapeHtml(time)}</span>`
        + `<span class="block">${escapeHtml(statusLabels[c.status] || c.status)}</span>`
        + `<span class="block text-[9px]">${escapeHtml(counts)}</span></button>`;
```

다음으로 변경(오픈 전이면 '오픈예정' 한 줄 추가):

```js
      const counts = `확정 ${c.confirmed_count || 0}·가능 ${c.available_count || 0}·대기 ${c.waitlist_count || 0}`;
      const preopen = c.is_open === false ? '<span class="block text-[9px] font-bold text-indigo-600">오픈예정</span>' : '';
      return `<button type="button" data-cal-class="${escapeHtml(c.class_id)}" class="block w-full rounded-md ${tone}${dim} px-1 py-0.5 text-left text-[10px] leading-tight">`
        + `<span class="block font-bold">${escapeHtml(time)}</span>`
        + `<span class="block">${escapeHtml(statusLabels[c.status] || c.status)}</span>`
        + preopen
        + `<span class="block text-[9px]">${escapeHtml(counts)}</span></button>`;
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_admin_calendar_ui -v`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add admin.html tests/test_static_pages.py
git commit -m "admin: 예약 오픈 일시·미리보기 입력 + 관리자 캘린더 오픈예정 배지"
```

---

### Task 5: `index.html` — 고객 캘린더 예정 표시 + 클릭 안내 + 다음 일정 제외

**Files:**
- Modify: `index.html:684-700`(normalizeClass), `:720-742`(timeRange/classAnchorHtml), `:826-842`(renderNextClassInfo), `:919-936`(클릭 핸들러)
- Test: `tests/test_static_pages.py`

**Interfaces:**
- Consumes: 뷰의 `is_open`/`open_at`/`preview_before_open`(Task 1), `class_reservation_summary?select=*` fetch(기존).
- Produces: `is_open=false` 칸은 예약 불가 '예정' 배지(`data-preview-open` 속성). 클릭 시 오픈 안내. 다음 일정 정보는 오픈된 수업만 대상.

- [ ] **Step 1: 계약 테스트 추가**

`tests/test_static_pages.py`의 `test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms`(27행~) 끝에 추가:

```python
        # 예약 오픈 예정(미리보기) 분기
        self.assertIn("data-preview-open", html)
        self.assertIn("is_open", html)
        self.assertIn("예약 오픈", html)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms -v`
Expected: FAIL (`data-preview-open` not found)

- [ ] **Step 3: normalizeClass에 필드 추가**

`index.html:688-700`의 반환 객체. 현재 마지막 세 필드:

```js
          is_public: item.is_public,
          status: item.status,
          place: item.place
        };
```

다음으로 변경:

```js
          is_public: item.is_public,
          status: item.status,
          place: item.place,
          is_open: item.is_open === undefined ? true : item.is_open !== false,
          open_at: item.open_at || null
        };
```

- [ ] **Step 4: 오픈일/안내 라벨 헬퍼 + classAnchorHtml 예정 분기**

`index.html`의 `function timeRange(item) {`(720행) 바로 위에 헬퍼 추가:

```js
      // open_at(ISO) → KST 벽시계 Date
      function openAtKst(iso) {
        if (!iso) return null;
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + 9 * 3600 * 1000);
      }
      function openDateLabel(iso) {
        var k = openAtKst(iso);
        return k ? (k.getUTCMonth() + 1) + '/' + k.getUTCDate() + ' 오픈' : '오픈 예정';
      }
      function openAnnounce(iso) {
        var k = openAtKst(iso);
        if (!k) return '아직 예약이 시작되지 않았습니다.';
        return (k.getUTCMonth() + 1) + '월 ' + k.getUTCDate() + '일 ' + k.getUTCHours() + '시부터 예약이 열립니다.';
      }
```

`classAnchorHtml`(724행)에서 `isPastClass` 블록 다음, `var available = availableOf(item);` 줄 바로 위에 예정 분기 추가:

```js
        // 오픈 전(예약 불가) — 예약 모달 대신 안내. 인원 숨김.
        if (item.is_open === false) {
          return '<button type="button" data-preview-open="' + escapeHtml(item.open_at || '') + '"'
            + ' class="block w-full text-left rounded-lg bg-ink-50 border border-dashed border-ink-300 px-1 py-1 transition cursor-pointer overflow-hidden">'
            + '<span class="block text-[9px] sm:text-[11px] font-bold leading-tight tracking-tight text-ink-500">' + timeRange(item) + '</span>'
            + '<span class="block text-[10px] leading-tight text-ink-400 whitespace-nowrap">' + openDateLabel(item.open_at) + '</span>'
            + '</button>';
        }
        var available = availableOf(item);
```

(참고: `escapeHtml`은 `index.html`에 이미 정의됨. `timeRange`는 `<br class="sm:hidden">`로 모바일 2줄 — 기존과 동일.)

- [ ] **Step 5: 클릭 핸들러에 예정 안내 추가**

`index.html:921-924`의 캘린더 클릭 핸들러 시작부. 현재:

```js
        calendarBody.addEventListener('click', function (event) {
          var link = event.target.closest('[data-reservation-date]');
          if (!link) return;
```

다음으로 변경(예정 칸 먼저 처리):

```js
        calendarBody.addEventListener('click', function (event) {
          var preview = event.target.closest('[data-preview-open]');
          if (preview) {
            window.alert(openAnnounce(preview.getAttribute('data-preview-open')));
            return;
          }
          var link = event.target.closest('[data-reservation-date]');
          if (!link) return;
```

- [ ] **Step 6: 다음 일정 정보에서 오픈 전 제외**

`index.html:831-832`의 upcoming 필터. 현재:

```js
        var upcoming = (window.__publicClasses || []).filter(function (c) { return !isPastClass(c); })
```

다음으로 변경:

```js
        var upcoming = (window.__publicClasses || []).filter(function (c) { return !isPastClass(c) && c.is_open !== false; })
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `python3 -m unittest tests.test_static_pages.StaticPageTests.test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms -v`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add index.html tests/test_static_pages.py
git commit -m "index: 예약 오픈 예정 칸 표시·클릭 안내, 다음 일정은 오픈분만"
```

---

### Task 6: 통합 검증 + 문서 + 배포 안내

**Files:**
- Modify: `docs/progress.md`
- Test: 전체 계약 테스트

- [ ] **Step 1: 전체 계약 테스트**

Run: `python3 -m unittest tests.test_static_pages -v`
Expected: 전부 PASS(기존 + 신규). 실패 시 해당 Task로 돌아가 수정.

- [ ] **Step 2: 로컬 회귀 확인(기존 오픈 수업 렌더)**

로컬 서버를 띄워(`python3 -m http.server 8123`) 모바일 폭(390px)·데스크탑(1100px)에서 캘린더가 기존처럼 보이는지 확인한다(라이브 DB엔 아직 새 컬럼이 없어 `is_open`이 undefined→true로 전부 오픈 취급, 회귀 없음을 확인하는 목적). 예정 칸 실제 표시는 운영 DB 적용 후 백관장이 테스트 수업으로 검증(Step 5).

- [ ] **Step 3: progress.md 갱신**

`docs/progress.md` 상단에 한 줄 요약 추가(`🆕 예약 오픈 일시 + 달력 미리보기(2026-06-19)`: 컬럼 2개·뷰·RLS·submit-reservation·admin-reservations·admin 모달·index 캘린더 변경, **배포 필요**). `마지막 갱신` 날짜를 2026-06-19로.

- [ ] **Step 4: progress.md 커밋**

```bash
git add docs/progress.md
git commit -m "docs: 예약 오픈 일시/미리보기 기능 진행상황 반영"
```

- [ ] **Step 5: 배포 안내(사용자에게 전달, 코드 작업 아님)**

이 기능은 정적 페이지 외에 **DB·Edge Function 배포가 필요**하다. 다음을 백관장에게 안내한다:
1. Supabase SQL Editor에서 `schema.sql`의 변경 구문만 실행: ① `alter table ... add column if not exists open_at / preview_before_open` 2줄, ② `create or replace view class_reservation_summary ...`, ③ `drop policy if exists ... ; create policy "public can read open classes" ...`. (전체 재실행 금지 — 시드 insert 제외.)
2. Edge Function 2개 재배포:
   ```bash
   supabase functions deploy submit-reservation --no-verify-jwt
   supabase functions deploy admin-reservations --no-verify-jwt
   ```
3. 정적 페이지(`admin.html`/`index.html`)는 push 시 GitHub Pages 자동 배포.
4. 적용 후 관리자에서 테스트 수업을 미래 `open_at` + 미리보기 ON으로 등록 → 고객 달력에 '예정'으로 뜨고 클릭 시 안내, 오픈 시각 지나면 예약 가능으로 바뀌는지 확인.

---

## Self-Review

**Spec coverage:**
- 컬럼 2개 → Task 1 ✓ / 뷰·RLS 자동 판정 → Task 1 ✓ / 예약 차단 → Task 2 ✓ / 관리자 API 필드 → Task 3 ✓ / 모달 입력·시각변환 → Task 4 ✓ / 관리자 캘린더 배지 → Task 4 ✓ / 고객 캘린더 예정 표시·클릭 안내 → Task 5 ✓ / 다음 일정 제외 → Task 5 ✓ / 테스트·배포 → Task 6 ✓. 누락 없음.

**Type consistency:**
- `open_at`(ISO string|null), `preview_before_open`(bool), `is_open`(bool)이 schema→admin-reservations→admin.html/index.html 전 구간 동일 명칭으로 사용됨.
- 변환 헬퍼: admin은 `openAtToInput`/`inputToOpenAtIso`, index는 `openAtKst`/`openDateLabel`/`openAnnounce`. 파일별로 이름 분리(중복 정의 없음).
- KST 변환 방식(`+9시간 후 toISOString().slice`, 입력은 `+09:00` 접미)도 양쪽 일관.

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 없음.
