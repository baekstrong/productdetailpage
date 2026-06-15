# 관리자 수업 일정 — 월간 캘린더 UI 설계 문서

**작성일:** 2026-06-15
**상태:** 설계 승인 대기

## 목표

관리자 "수업 일정 등록/관리"를 **월간 캘린더 중심**으로 바꿔, 한 달 일정을 한눈에 보고 캘린더에서 등록·수정·삭제까지 한다. 중복되는 "일정 선택" 드롭다운은 제거하고, 목록 표의 행을 클릭해 신청 현황을 조회한다.

## 핵심 결정 (확정)

- 등록 인라인 폼 → **등록/수정 공용 모달**로 대체.
- **월간 캘린더 신규** — 칸에 시간·상태·신청현황 표시. 빈 날짜 클릭→등록 모달, 수업 칸 클릭→수정 모달(삭제 포함).
- **목록 표 유지** — 행 클릭으로 "수업 선택"(아래 신청현황 갱신), 선택 행 하이라이트. 수정/비공개·공개/삭제 버튼 유지.
- **"일정 선택" 드롭다운 섹션 제거** — 표가 그 역할을 대신.
- 백엔드(Edge Function·DB) 변경 없음. `admin.html` 프론트만.

## 화면 구성 (위→아래)

1. **상단 새로고침 바** (기존 유지)
2. **수업 일정 등록/관리** (개편):
   - **월간 캘린더** (신규)
   - **목록 표** (유지 + 행 선택)
3. ~~일정 선택 드롭다운~~ → **제거**
4. **요약 카드 / 수업일별 예약·신청 현황 / 문자 발송 현황** (유지 — "선택된 수업" 기준이 드롭다운→표·캘린더 클릭으로 바뀜)

## 컴포넌트

### A. 월간 캘린더 (admin-calendar)
- index.html의 `calendar-grid` CSS·월 이동 로직을 admin용으로 포팅(별도 구현 — 칸 내용이 다름).
- 상태: `let adminCalView = { year, month }`. 이전/오늘/다음 버튼으로 이동.
- 날짜 칸 렌더: 그날 `adminData.classes`의 수업들을 배지로. 배지 내용:
  - 시간 `13:00~16:00`
  - 상태(예약가능/대기가능/마감/숨김) — 색으로 구분
  - 신청현황 `확정 N·가능 M·대기 K`
  - 비공개는 흐리게(opacity)
- 클릭:
  - 수업 없는 날 클릭 → `openClassModal('create', { class_date: 그날 })`
  - 수업 배지 클릭 → `openClassModal('edit', classItem)`

### B. 등록/수정 모달 (class-modal)
- 필드: 날짜(date)·시작(time)·종료(time)·정원(number)·장소(text)·상태(select)·공개(checkbox) — 기존 인라인 폼 필드 그대로.
- 모드: `create`(빈 값 또는 클릭 날짜) / `edit`(수업 값 채움 + 삭제 버튼 노출).
- 저장: create→`callAdminApi('createClass', {class})`, edit→`callAdminApi('updateClass', {classId, updates})`.
- 삭제: edit 모드의 삭제 버튼 → 기존 delete 흐름(결제완료 방어·force 재확인·캘린더 동기화 그대로).
- 닫기: 배경/X/ESC. 저장·삭제 성공 시 닫고 `loadAdminData()`.

### C. 목록 표 (class-rows) — 선택 기능 추가
- 기존 표 유지(수업 일시·장소·정원·상태·공개·신청현황·관리 버튼).
- 행에 `data-select-class="<classId>"` 부여. 행의 **버튼이 아닌 영역 클릭** → `setSelectedClass(classId)`.
- 선택된 행은 하이라이트 클래스(예: `bg-blue-50 ring-2 ring-blue-300`).
- 관리 버튼(수정/비공개로/삭제)은 기존 동작 유지. 수정 버튼 → `openClassModal('edit', ...)`. (버튼 클릭은 `event.stopPropagation`으로 행 선택과 분리)

### D. 선택 상태 관리
- 현재 `selectedClassId()`는 `class-filter`(드롭다운) value를 읽음(admin.html:214). 드롭다운 제거에 따라:
  - `let currentClassId = '';` 모듈 변수 도입.
  - `selectedClassId()` → `return currentClassId;`
  - `setSelectedClass(id)` → `currentClassId = id; renderAdminData();` + 표 행 하이라이트 갱신.
- `renderAdminData`: `currentClassId`가 없거나 사라진 수업이면 기본값을 가장 가까운 다음 수업(`upcomingClasses[0]`)으로(기존 로직과 동일, 대상만 변수로).
- `loadAdminData`: 선택 보존도 `currentClassId` 기준.
- `renderClasses`/`classOptionHtml`/`class-filter` change 리스너 — 드롭다운과 함께 제거.

## 데이터 흐름

- `adminData.classes`(요약 포함: class_date·start_time·end_time·status·capacity·confirmed_count·available_count·waitlist_count·is_public·place·class_id)는 이미 `loadAdminData`가 제공 → 캘린더·표 둘 다 이걸로 렌더.
- 캘린더·표·모달 모두 같은 `adminData.classes`를 본다(단일 소스). CRUD 후 `loadAdminData`로 일괄 갱신.

## 에러 처리

- 모달 저장/삭제 실패 → 모달 내 메시지로 표시(기존 class-form-message 패턴 재사용).
- 캘린더/표는 `adminData.classes`가 비면 "등록된 수업이 없습니다" 안내.

## 테스트

- 계약 테스트(`tests/test_static_pages.py`): admin.html에 캘린더 마크업(`admin-calendar`/월 이동), 모달(`class-modal`), `setSelectedClass`, `openClassModal`, `data-select-class` 존재 확인. 제거된 `class-filter`(드롭다운) 부재 확인. 기존 금지어(service_role 등) 유지.
- 수동 검증: 캘린더 빈날짜→등록 / 수업칸→수정·삭제 / 표 행 클릭→아래 갱신+하이라이트 / 신청현황·문자현황이 선택 수업 따라가는지.

## 작업 범위 / 비범위

- **범위:** `admin.html`(캘린더·모달·표 선택·선택상태), 계약 테스트, 문서.
- **비범위:** Edge Function·DB·문자·캘린더 동기화 백엔드(전부 기존 그대로 재사용).

## 알려진 한계 / YAGNI

- 캘린더 수업 칸 클릭은 "수정 모달"만(선택+조회는 표로). 두 진입점 역할 분리.
- 드래그로 일정 이동 등 고급 기능은 미포함(YAGNI).
