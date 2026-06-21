# 공휴일 표시 (대체공휴일 포함) 설계

**작성일:** 2026-06-21
**목표:** 고객·관리자 캘린더에 한국 공휴일(대체공휴일 포함)을 표시해 날짜를 정확히 확인할 수 있게 한다. 공휴일에도 수업 일정은 자유롭게 등록할 수 있어야 한다(표시 전용, 등록 제한 없음).

**범위:** `holidays.js`(신규), `index.html`(고객 캘린더), `admin.html`(관리자 캘린더), 계약 테스트. 백엔드·DB·Edge Function 무변경 → 배포 없이 push만으로 반영(정적 파일).

---

## 1. 데이터 — `holidays.js` (단일 공유 파일)

루트에 `holidays.js`를 만들고 `index.html`·`admin.html`이 인라인 `<script type="module">`보다 **먼저** `<script src="holidays.js"></script>`로 로드한다. 두 페이지에 중복으로 넣으면 매년 두 곳을 고쳐야 하므로, 단일 파일로 두고 한 곳만 갱신한다.

```js
// holidays.js — 한국 법정공휴일 + 대체공휴일 (양력 고정 + 음력 + 대체).
// 매년 새 연도 공휴일을 추가한다. 정부 임시공휴일도 발표되면 한 줄 추가.
window.KR_HOLIDAYS = {
  'YYYY-MM-DD': '공휴일명',
  // ... 2025 ~ 2027
};
window.holidayName = function (dateStr) {
  return (window.KR_HOLIDAYS && window.KR_HOLIDAYS[dateStr]) || '';
};
```

- 날짜 키 형식은 캘린더가 쓰는 `YYYY-MM-DD`(예: index의 `ymd()`, admin의 `dateStr`)와 동일하게 맞춘다.
- 포함: 양력 고정(신정·삼일절·어린이날·현충일·광복절·개천절·한글날·성탄절), 음력(설날·추석·부처님오신날), 그리고 **대체공휴일**.
- 범위: **2025~2027**. 정확한 날짜·대체공휴일 적용은 **구현 계획 단계에서 공식 자료(공공데이터/관보 기준)로 확정**한다(이 스펙은 구조만 정의).
- 로드 실패/미정의에 안전하도록 `holidayName`은 항상 문자열(없으면 `''`)을 반환한다. 캘린더 코드는 `window.holidayName`이 없을 때도 깨지지 않게 가드(`typeof`)한다.

## 2. 표시 — 양쪽 캘린더 칸

**고객 캘린더(`index.html` `dayCellHtml`/요일헤더), 관리자 캘린더(`admin.html` `renderAdminCalendar`)** 공통:

- **공휴일 날짜**: 날짜 숫자를 빨강 톤(예: `text-red-500`)으로, 칸 안에 **공휴일명**을 작은 빨강 글씨로 표시(수업 배지 유무와 무관).
- **일요일**: 날짜 숫자를 빨강(한국 달력 관행). 토요일·평일은 기존 색 유지.
- 우선순위: 공휴일이면서 일요일이면 공휴일명을 보여준다(둘 다 빨강이므로 색 충돌 없음).
- '오늘' 강조(빨강 원 등 기존 표시)는 그대로 두고 공휴일 표시와 공존시킨다.
- **모바일 폭(44px) 제약**: 공휴일명이 칸을 넘치지 않도록 작은 폰트(예: `text-[9px]`)·`leading-tight`·`overflow-hidden`로 처리하고, 구현 때 iPhone 폭(390px)·데스크탑에서 Playwright로 깨짐 없는지 확인한다(기존 모바일 배지 깨짐 수정 규칙과 동일 선상).

## 3. 등록 제한 없음 (요청 사항)

공휴일 표시는 **순수 표시 전용**이다. 수업 등록(`admin.html` 모달 → `createClass`)에는 날짜 제한이 없고, 이 기능은 그 로직을 건드리지 않는다. 따라서 **공휴일에도 지금처럼 수업을 등록**할 수 있다.

## 4. 테스트 (`tests/test_static_pages.py`)

계약(문자열 존재) 테스트 추가:
- `holidays.js`가 존재하고 `window.KR_HOLIDAYS`·`holidayName`을 정의한다.
- `index.html`·`admin.html`이 `holidays.js`를 로드한다(`src="holidays.js"`).
- 양쪽 캘린더 렌더 코드가 `holidayName`(또는 `KR_HOLIDAYS`)을 참조한다.
- 대표 공휴일 한두 개(예: `신정`, `어린이날`)가 `holidays.js`에 들어 있다.
- 기존 금지 항목(시크릿 미노출, 내부 용어 미노출 등) 유지.

## 5. 주의 / 엣지

- **DRY**: 공휴일 맵은 `holidays.js` 한 곳에만. 양쪽 페이지는 로드만.
- **로드 순서**: `holidays.js`는 일반 스크립트(전역 `window.KR_HOLIDAYS`)로, 캘린더를 그리는 모듈 스크립트보다 먼저 로드.
- **정확성**: 대체공휴일 규칙(공휴일이 일요일/다른 공휴일/토요일과 겹칠 때)은 직접 계산하지 않고 **공식 발표된 확정 날짜를 그대로 하드코딩**한다(계산 로직의 오류 위험 회피).
- **갱신성**: 연도가 바뀌면 `holidays.js`에 새 연도 공휴일만 추가. 코드 구조는 그대로.
- GitHub Pages 상대경로(`holidays.js`)로 로드(canonical `/productdetailpage/` 하위).
