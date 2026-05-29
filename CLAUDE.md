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
<!-- GIT-WORKFLOW-RULE:END -->


백관장의 **케틀벨 원데이 수업** 상세/예약/결제 페이지. 정적 HTML(GitHub Pages 호스팅) 프론트 + Supabase(DB·Edge Functions) 백엔드로 예약 대기와 관리자 기능을 처리한다.

> 운영/콘텐츠 정책(상품 포지션, 문자 템플릿, 문구 톤, 마케팅 금지 규칙 등)의 상세 기준은 `AGENTS.md`에 있다. 코드 작업 시 그 정책을 따르되, 실제 구현 상태는 이 문서를 기준으로 한다.

## 기술 스택

- **프론트**: 단일 파일 정적 HTML + 인라인 vanilla JS (빌드 도구·프레임워크·`node_modules` 없음). `index.html`, `admin.html`, `checkout.html`, `email/index.html`.
- **백엔드**: Supabase Postgres + Edge Functions(Deno/TypeScript). 프로젝트 ref `vjoxzbxcylqyhxezxiuj`.
- **문자**: Solapi (Edge Function에서 서버사이드 호출, 현재 실제 전송부는 미구현 스텁).
- **테스트**: Python `unittest` (의존성 없음, 표준 라이브러리만).
- **호스팅**: GitHub Pages (`.nojekyll` 존재, canonical `https://baekstrong.github.io/productdetailpage/`).

## 명령어

```bash
# 정적 페이지 계약 테스트 (HTML/JS/스키마/Edge Function의 필수 문자열 검증)
python3 -m unittest tests.test_static_pages -v

# 로컬 미리보기 (정적 서버)
python3 -m http.server 8000   # http://localhost:8000/index.html

# Supabase Edge Function 배포 (Supabase CLI 필요, 프로젝트는 이미 link됨)
supabase functions deploy admin-auth
supabase functions deploy admin-reservations
supabase functions deploy solapi-reservations

# DB 스키마 적용: supabase/schema.sql 을 Supabase SQL Editor에서 실행
```

`tests/test_static_pages.py`는 동작 테스트가 아니라 **HTML/JS/스키마에 특정 문자열이 있는지/없는지 검증하는 계약(contract) 테스트**다. 페이지의 카피, Supabase 키 노출 금지(`service_role` 미포함), 데모 데이터 제거 등을 강제한다. 마크업이나 문구를 바꾸면 이 테스트가 깨질 수 있으니 함께 확인할 것.

## 아키텍처

### 페이지 흐름
- **`index.html`** — 공개 상세 + 예약 대기 페이지. 세일즈 카피 + 월간 달력 UI(`calendar-grid`). 날짜별 예약 가능/대기 인원을 `class_reservation_summary`(anon)에서 fetch하고, 실패 시 `data/classes.json`으로 폴백. 예약 폼은 `submitReservationToSupabase()`로 `reservations` 테이블에 anon insert.
- **`checkout.html`** — 차수별 결제 안내 페이지. 네이버 스마트스토어 결제 링크(`smartstore.naver.com/easystrength101/products/9825334073`)로 전환 유도. 자체 결제 처리는 없음(스마트스토어 외부 결제).
- **`admin.html`** — 비밀번호 보호 관리자 화면. `callAdminApi()`가 `admin-reservations` Edge Function을 호출(action: `list`/`updateReservation`)해 예약 현황 조회·상태 변경. 휴대폰 번호 마스킹 표시, 데모/`localStorage` 데이터 없음(전부 서버 데이터).
- **`email/index.html`** — 이메일 발송용 HTML 상세페이지.
- **`data/classes.json`** — Supabase 미응답 시 달력 폴백 데이터(목업).
- **`smartstore/`** — 스마트스토어 상세페이지 이미지 자산(png/jpg).

### Supabase
- **스키마** (`supabase/schema.sql`): `classes`, `reservations`, `message_logs` 테이블 + `class_reservation_summary` 뷰. RLS 활성화 — anon은 공개 class 요약 읽기 + 본인 예약 insert만 가능, reservations/message_logs 직접 read는 차단. 관리자 read/update는 service_role을 쓰는 Edge Function 경유.
- **Edge Functions** (`supabase/functions/`):
  - `admin-auth` — 비밀번호 SHA-256 해시를 `ADMIN_PASSWORD_HASH`와 timing-safe 비교, 1시간짜리 토큰 발급.
  - `admin-reservations` — 비밀번호 검증 후 service_role로 예약 목록 조회/상태 업데이트. 업데이트 허용 필드 화이트리스트(`reservation_status`, `payment_status`, `waitlist_order`, `admin_memo`).
  - `solapi-reservations` — 메시지 타입별 템플릿 채워 Solapi 발송(현재 실제 HMAC 전송부는 스텁, 시크릿 없으면 skip). 복습 영상 링크는 자동 발송 대상이 아님.

### 문서
- `docs/admin-schedule-management-plan.md`, `docs/plans/admin-real-data-connection-plan.md` — 관리자 기능/실데이터 연동 설계 계획서.

## 컨벤션

- 프론트 JS는 인라인 + 구형 호환 스타일(`var`, `function`)이 섞여 있다. 외부 의존성·번들러 추가하지 말 것.
- 페이지 카피와 정책 문구는 `AGENTS.md` 톤 가이드를 따른다(과한 마케팅·몸짱·고강도·기록 경쟁 프레임 금지, "체력은 의지보다 시스템").
- 고객 화면에는 개인 대기 순번을 노출하지 않는다. 내부 운영 용어("백관장", "Solapi", "관리자 화면" 등)를 공개 `index.html`에 넣지 않는다(테스트가 강제).
- 결제 완료 전에는 "수업 확정"이라 표기하지 않는다. 예약 대기와 결제 확정을 명확히 구분.

## 주의사항 / 함정

- **시크릿 절대 클라이언트 노출 금지**: `index.html`/`admin.html`에는 Supabase **anon(publishable) key**만 둔다. `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD_HASH`, `SOLAPI_API_KEY`/`SOLAPI_API_SECRET`는 **Edge Function 환경변수(Deno.env)로만** 설정한다. 테스트가 `admin.html`에 `service_role` 문자열이 없는지 검사한다.
- 새 Edge Function/시크릿은 `supabase secrets set`으로 설정하고 코드/저장소에 하드코딩하지 말 것.
- `solapi-reservations`의 실제 발송 로직은 미완(스텁). Solapi HMAC 인증 헤더 구현이 필요.
- `data/classes.json`은 폴백 목업이라 실제 Supabase 데이터와 어긋날 수 있다. 날짜·인원 변경 시 둘 다 점검(테스트가 특정 날짜·인원 문자열을 검사함).
- 계약 테스트의 `assertNotIn`이 많다(데모 이름 `홍길동`/`김철수`, 비밀번호 `8156`, `<details>` 등 금지). 리팩터링 시 이 금지 항목을 되살리지 말 것.
- 공개 배포 전 백관장 승인이 필요(`AGENTS.md` 14항).
