# CLAUDE.md

<!-- GIT-WORKFLOW-RULE:START -->
## ⚠️ Git 작업 규칙 (필수)

이 저장소에서 작업할 때는 아래 순서를 **반드시** 지킨다.

### 1. 작업 시작 시 — 가장 먼저 `git pull`
원격의 최신 변경사항을 받아온 뒤에 작업을 시작한다.
```bash
git pull
```
- 충돌(conflict)이 나면 작업 전에 먼저 해결한다.
- pull 없이 곧바로 코드를 수정하지 않는다.

### 2. 작업 종료 시 — `add` → `commit` → `push`
변경사항을 반드시 커밋하고 원격에 푸시한 뒤 작업을 마친다.
```bash
git add -A
git commit -m "<한글 커밋 메시지>"
git push
```
- 커밋 메시지는 **한글**로, 무엇을·왜 바꿨는지 알 수 있게 작성한다.
- 변경사항이 있는데 커밋/푸시하지 않고 작업을 끝내지 않는다.

### 3. 작업 종료 시 — `docs/progress.md` 진행상황 요약 갱신
커밋/푸시 전에 **`docs/progress.md`를 최신 상태로 갱신**한다. 다음 세션이 이 문서만 읽고 바로 이어서 작업할 수 있게 한다.
- 이번에 무엇을 했는지, 현재 배포/운영 상태, **다음에 할 일**을 항상 최신으로 유지한다.
- `마지막 갱신` 날짜를 오늘 날짜로 바꾼다.
- 이 갱신도 같은 커밋에 포함해 push 한다.
<!-- GIT-WORKFLOW-RULE:END -->


백관장의 **케틀벨 원데이 수업** 상세/예약/결제 페이지. 정적 HTML(GitHub Pages 호스팅) 프론트 + Supabase(DB·Edge Functions) 백엔드로 예약 대기와 관리자 기능을 처리한다.

> 운영/콘텐츠 정책(상품 포지션, 문자 템플릿, 문구 톤, 마케팅 금지 규칙 등)의 상세 기준은 `AGENTS.md`에 있다. 코드 작업 시 그 정책을 따르되, 실제 구현 상태는 이 문서를 기준으로 한다.

## 기술 스택

- **프론트**: 단일 파일 정적 HTML + 인라인 vanilla JS (빌드 도구·프레임워크·`node_modules` 없음). `index.html`, `admin.html`, `checkout.html`, `email/index.html`.
- **백엔드**: Supabase Postgres + Edge Functions(Deno/TypeScript). 프로젝트 ref `vjoxzbxcylqyhxezxiuj`.
- **문자**: Solapi (Edge Function에서 서버사이드 호출, HMAC-SHA256 인증 구현 완료 — 예약 발송/취소 지원, 시크릿 없으면 안전 skip).
- **테스트**: Python `unittest` (의존성 없음, 표준 라이브러리만).
- **호스팅**: GitHub Pages (`.nojekyll` 존재, canonical `https://baekstrong.github.io/productdetailpage/`).

## 명령어

```bash
# 정적 페이지 계약 테스트 (HTML/JS/스키마/Edge Function의 필수 문자열 검증)
python3 -m unittest tests.test_static_pages -v

# 로컬 미리보기 (정적 서버)
python3 -m http.server 8000   # http://localhost:8000/index.html

# Supabase Edge Function 배포 (Supabase CLI 필요, 프로젝트는 이미 link됨)
# 반드시 --no-verify-jwt 로 배포 (config.toml에도 verify_jwt=false 명시됨)
supabase functions deploy admin-reservations --no-verify-jwt
supabase functions deploy solapi-reservations --no-verify-jwt
supabase functions deploy submit-reservation --no-verify-jwt

# DB 스키마 적용: supabase/schema.sql 을 Supabase SQL Editor에서 실행
# (운영 DB에는 전체 재실행 금지 — 시드 insert 포함. 필요한 구문만 골라 실행)
```

`tests/test_static_pages.py`는 동작 테스트가 아니라 **HTML/JS/스키마에 특정 문자열이 있는지/없는지 검증하는 계약(contract) 테스트**다. 페이지의 카피, Supabase 키 노출 금지(`service_role` 미포함), 데모 데이터 제거 등을 강제한다. 마크업이나 문구를 바꾸면 이 테스트가 깨질 수 있으니 함께 확인할 것.

## 아키텍처

### 페이지 흐름
- **`index.html`** — 공개 상세 + 예약 대기 페이지. 세일즈 카피 + 월간 달력 UI(`calendar-grid`). 날짜별 예약 가능/대기 인원을 `class_reservation_summary`(anon)에서 fetch(실패 시 "일정을 불러오지 못했습니다" 안내 — 폴백 목업 없음). '수업 정보' 섹션은 가장 가까운 다음 일정으로 동적 표시(`renderNextClassInfo`). 예약 폼은 `submitReservationToSupabase()`가 공개 Edge Function `submit-reservation`을 호출(개인정보 동의 필수, 직접 insert 아님).
- **`checkout.html`** — 차수별 결제 안내 페이지. 네이버 스마트스토어 결제 링크(`smartstore.naver.com/easystrength101/products/9825334073`)로 전환 유도. 자체 결제 처리는 없음(스마트스토어 외부 결제).
- **`admin.html`** — 비밀번호 보호 관리자 화면. `callAdminApi()`가 `admin-reservations` Edge Function을 호출(action: `list`/`updateReservation`)해 예약 현황 조회·상태 변경. 휴대폰 번호 마스킹 표시, 데모/`localStorage` 데이터 없음(전부 서버 데이터).
- **`email/index.html`** — 이메일 발송용 HTML 상세페이지.
- **`smartstore/`** — 스마트스토어 상세페이지 이미지 자산(png/jpg).

### Supabase
- **스키마** (`supabase/schema.sql`): `classes`, `reservations`, `message_logs` 테이블 + `class_reservation_summary` 뷰. `classes.google_event_id`는 수업↔구글 캘린더 이벤트 매핑용. RLS 활성화 — anon은 공개 class 요약 읽기만 가능(예약 insert는 `submit-reservation` 함수 경유, 직접 insert 정책 없음), reservations/message_logs 직접 read 차단. `(class_id, phone)` 활성 신청 unique 인덱스(`reservations_active_unique`)로 중복 신청 차단. 관리자 read/update는 service_role을 쓰는 Edge Function 경유.
- **Edge Functions** (`supabase/functions/`):
  - `submit-reservation` — 공개 신청 엔드포인트(비밀번호 없음). 검증(이름·010 11자리·개인정보 동의) → 신청 가능 수업 확인 → 중복 차단(409) → service_role insert → 접수 확인 문자(베스트 에포트).
  - `lookup-reservation` — 공개 본인 조회(이름+전화 정확 일치). 고객용 상태 라벨만 반환, 대기 순번 등 내부 정보 비노출.
  - `admin-reservations` — 비밀번호 검증 후 service_role로 예약 목록 조회/상태 업데이트(상태 변경 요청일 때만 문자 트리거). 수업 CRUD(`createClass`/`updateClass`/`deleteClass`) 시 `calendar.ts`로 구글 캘린더 이벤트 동기화(베스트 에포트). 업데이트 허용 필드 화이트리스트(`reservation_status`, `payment_status`, `waitlist_order`, `admin_memo`).
  - `admin-reservations/calendar.ts` — 서비스 계정 JWT(RS256)→OAuth→Google Calendar v3 REST. 시크릿 `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID`(근력학교 앱과 동일 재사용), 미설정 시 안전 skip.
  - `solapi-reservations` — 메시지 타입별 템플릿 채워 Solapi 발송(HMAC-SHA256, 예약 발송 `scheduledDate`/취소 `cancelGroupId` 지원, 시크릿 없으면 안전 skip). 인증은 ① 내부 호출(Bearer service_role) 또는 ② 관리자 비밀번호. 복습 영상 링크는 자동 발송 대상이 아님.

### 문서
- `docs/admin-schedule-management-plan.md`, `docs/plans/admin-real-data-connection-plan.md` — 관리자 기능/실데이터 연동 설계 계획서.

## 컨벤션

- 프론트 JS는 인라인 + 구형 호환 스타일(`var`, `function`)이 섞여 있다. 외부 의존성·번들러 추가하지 말 것.
- 페이지 카피와 정책 문구는 `AGENTS.md` 톤 가이드를 따른다(과한 마케팅·몸짱·고강도·기록 경쟁 프레임 금지, "체력은 의지보다 시스템").
- 고객 화면에는 개인 대기 순번을 노출하지 않는다. 내부 운영 용어("백관장", "Solapi", "관리자 화면" 등)를 공개 `index.html`에 넣지 않는다(테스트가 강제).
- 결제 완료 전에는 "수업 확정"이라 표기하지 않는다. 예약 대기와 결제 확정을 명확히 구분.

## 주의사항 / 함정

- **시크릿 절대 클라이언트 노출 금지**: `index.html`/`admin.html`에는 Supabase **anon(publishable) key**만 둔다. `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`, `GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID`는 **Edge Function 환경변수(Deno.env)로만** 설정한다. 테스트가 `admin.html`에 `service_role` 문자열이 없는지 검사한다.
- 새 Edge Function/시크릿은 `supabase secrets set`으로 설정하고 코드/저장소에 하드코딩하지 말 것.
- 계약 테스트의 `assertNotIn`이 많다(데모 이름 `홍길동`/`김철수`, 비밀번호 `8156`, `<details>`, `name="email"`, `rest/v1/reservations`, `admin-auth` 등 금지). 리팩터링 시 이 금지 항목을 되살리지 말 것.
- 공개 배포 전 백관장 승인이 필요(`AGENTS.md` 14항).
