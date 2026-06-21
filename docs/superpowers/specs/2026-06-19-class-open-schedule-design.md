# 예약 오픈 예약 + 달력 미리보기 설계

**작성일:** 2026-06-19
**목표:** 수업 등록 시 "예약 오픈 일시"를 지정해, 그 전에는 예약을 막고(비공개) 지정 시각 이후 자동으로 예약을 열 수 있게 한다. 오픈 전이라도 원하면 달력에 "예약 오픈 예정"으로 미리 노출할 수 있다.

**범위:** `supabase/schema.sql`(테이블·뷰·RLS), `submit-reservation`/`admin-reservations` Edge Function, `admin.html`(등록 모달·관리자 캘린더), `index.html`(고객 캘린더), 계약 테스트. 결제·문자·구글 캘린더 로직은 변경하지 않는다.

---

## 1. 데이터 모델

`classes` 테이블에 컬럼 2개 추가. 운영 DB에는 `alter table ... add column if not exists`로 안전하게 적용한다(전체 재실행 금지).

```sql
alter table public.classes add column if not exists open_at timestamptz;
alter table public.classes add column if not exists preview_before_open boolean not null default false;
```

- `open_at` — 예약 오픈 일시(절대 시각, timestamptz). **NULL이면 즉시 오픈** → 기존 수업은 NULL이라 지금과 동일하게 동작한다.
- `preview_before_open` — 오픈 전(아직 예약 불가)에도 고객 달력에 "예정"으로 표시할지. 기본 false.

### 오픈 판정
"오픈됨" = `open_at is null OR open_at <= now()`. now()는 UTC지만 timestamptz 비교는 절대 시각이라 타임존과 무관하게 정확하다.

---

## 2. 공개 상태 (4가지)

`is_public`(기존 마스터 스위치)과 새 컬럼의 조합:

| 조건 | 고객 달력 | 예약 |
|---|---|---|
| `is_public=false` 또는 `status='hidden'` | 안 보임 | 불가 |
| 오픈됨 (`open_at` NULL 또는 ≤ now) | 기존대로 표시(시간·인원) | 가능(기존 규칙: `available>0 && status≠closed`) |
| 오픈 전 + `preview_before_open=true` | "예정" 표시(시간 + "M/D 오픈"), 인원 숨김 | 불가(클릭 시 안내) |
| 오픈 전 + `preview_before_open=false` | 안 보임 | 불가 |

`is_public`은 "이 수업을 아예 숨길지"의 마스터 스위치로 유지한다(끄면 무조건 안 보임). 오픈 일시/예정 표시는 그 위에서만 동작한다. 관리자 모달 안내 문구로 둘의 차이를 명시한다.

---

## 3. 백엔드

### 3.1 뷰 `class_reservation_summary` (`supabase/schema.sql`)
- select 목록에 `c.open_at`, `c.preview_before_open`, 그리고 계산 컬럼 `(c.open_at is null or c.open_at <= now()) as is_open` 추가.
- `where` 절을 다음으로 변경:
  ```sql
  where c.is_public = true
    and c.status <> 'hidden'
    and (c.open_at is null or c.open_at <= now() or c.preview_before_open = true)
  ```
  → 오픈됐거나 미리보기인 수업만 노출. 오픈 전 + preview=false는 제외.
- 인원 카운트 컬럼은 그대로 둔다(오픈 전엔 어차피 0). 인원 숨김은 프론트가 `is_open=false`로 판단해 처리한다.

### 3.2 RLS — anon select 정책 (`supabase/schema.sql`)
현재 `using (is_public = true and status <> 'hidden')`를 다음으로 변경:
```sql
using (
  is_public = true
  and status <> 'hidden'
  and (open_at is null or open_at <= now() or preview_before_open = true)
)
```
뷰는 정의자 권한으로 실행돼 where가 실질 필터지만, anon이 `classes`를 직접 쿼리해도 오픈 전 비공개(preview=false) 수업이 새지 않도록 RLS도 같은 조건으로 막는다.

### 3.3 `submit-reservation/index.ts`
예약 가능 확인부(현재 `is_public !== true || status === 'hidden'` 거부 + 과거 거부, index.ts:129~137):
- classes select에 `open_at` 추가.
- `open_at`이 있고 미래(`new Date(open_at) > now`)면 거부: 메시지 `"아직 예약이 시작되지 않은 수업입니다"`.
- 과거 수업 거부, 중복 거부 등 기존 로직은 유지.

### 3.4 `admin-reservations/index.ts`
- `CLASS_FIELDS`(index.ts:175)에 `'open_at'`, `'preview_before_open'` 추가.
- `pickClassFields`(index.ts:178): `preview_before_open`은 `Boolean()`. `open_at`은 빈 문자열/누락이면 `null`, 값 있으면 문자열 그대로(클라가 ISO 문자열 전송).
- `listClasses` 응답 매핑(index.ts:213 근처)에 `open_at`, `preview_before_open`, `is_open`(= open_at null 또는 ≤ now) 포함 → 관리자 화면이 상태 구분에 사용.

---

## 4. 프론트

### 4.1 `admin.html` 등록/수정 모달
기존 필드(날짜·시간·정원·장소·상태·공개) 아래에 추가:
- **예약 오픈 일시**: `<input type="datetime-local" id="modal-class-open-at">`. 비우면 즉시 오픈. 안내: "비워두면 등록 즉시 예약 오픈됩니다."
- **오픈 전에도 달력에 표시**: `<input type="checkbox" id="modal-class-preview">`. 안내: "체크하면 오픈 전에도 고객 달력에 '예약 오픈 예정'으로 보입니다."
- `is_public` 체크박스 라벨/안내를 보강해 마스터 스위치임을 명시.

**시각 변환:** `datetime-local`은 타임존 없는 로컬값이다. 백관장은 KST로 입력하므로, 저장 시 `"YYYY-MM-DDTHH:mm:00+09:00"`로 만들어 전송한다. 모달에 값을 채울 때는 저장된 timestamptz를 KST 기준 `YYYY-MM-DDTHH:mm`로 역변환한다(`open_at` 없으면 빈칸). 변환 헬퍼는 모달 채우기/저장 양쪽에서 쓴다.

`openClassModal`의 채우기·`createClass`/`updateClass` 페이로드에 `open_at`(ISO 또는 null), `preview_before_open`(bool) 포함.

### 4.2 `admin.html` 관리자 캘린더 배지 (`renderAdminCalendar`, 481 근처)
오픈 전 수업(`is_open=false`)이면 배지에 "오픈예정" 한 줄을 덧붙여 관리자가 상태를 구분하게 한다. 색/레이아웃은 기존 톤 유지.

### 4.3 `index.html` 고객 캘린더
- fetch 매핑(695~698 근처)에 `is_open`, `open_at`, `preview_before_open` 추가.
- 필터(781): 기존 `is_public !== false && status !== 'hidden'` 유지(뷰가 이미 걸러주지만 클라 안전망). 예정 수업도 통과시킨다.
- **`classAnchorHtml`**(724~742): `is_open` 분기.
  - `is_open=true`: 기존 렌더(시간·인원·예약 버튼).
  - `is_open=false`(예정): 회색/점선 톤 박스. 시간(`13:00~16:00`, 모바일 2줄 규칙 유지) + "M/D 오픈"(예: "6/25 오픈"). 인원 숨김. 예약 버튼 아님(`data-reservation-date` 미부여). 대신 `data-preview-open="<open_at ISO>"` 같은 표식.
  - 칸 폭이 좁으므로 "M/D 오픈"이 들어가는지 모바일(390px)에서 확인한다.
- **클릭 핸들러**: 예정 칸(`data-preview-open`) 클릭 시 예약 모달을 띄우지 않고, "○월 ○일 HH시부터 예약 오픈됩니다" 안내를 보여준다(기존 안내 표시 수단 재사용).
- `timeRange`/모바일 배지 깨짐 수정(2026-06-19)과 호환되게 둔다.

### 4.4 '수업 정보' 섹션 (다음 일정, `index.html`)
다음 일정 선택 대상에서 **오픈 전 예정 수업은 제외**한다(오픈된 수업만). 오픈 전 수업을 다음 일정으로 잡으면 "예약 가능 인원" 안내가 애매해지기 때문. 오픈된 다음 일정이 없으면 기존 빈 상태 문구를 따른다.

---

## 5. 테스트 (`tests/test_static_pages.py`)
계약(문자열 존재/부재) 테스트 추가:
- `schema.sql`에 `open_at`, `preview_before_open`, 뷰의 `is_open` 존재.
- `submit-reservation`에 오픈 전 거부 메시지(`아직 예약이 시작되지 않은`) 존재.
- `admin.html`에 `modal-class-open-at`, `modal-class-preview` 존재.
- `index.html`에 `data-preview-open`, 예정/오픈 안내 분기 키워드 존재.
- 비밀키 미노출 등 기존 금지 항목 유지.

---

## 6. 엣지 케이스 / 주의
- **기존 수업**: `open_at` NULL → 즉시 오픈으로 지금과 동일.
- **오픈 직후**: now() 통과 시 자동으로 예약 가능. 별도 배치/cron 불필요(뷰가 매 조회마다 판정).
- **preview=true, 오픈 후**: 일반 오픈 수업과 동일하게 동작(preview 플래그는 오픈 전에만 의미).
- **시각 입력 누락/잘못된 값**: 빈 값 → NULL(즉시 오픈). 백엔드 `pickClassFields`가 정규화.
- **고객 화면 정책 유지**: 개인 대기 순번 비노출, 내부 운영 용어 비노출(테스트 강제).
