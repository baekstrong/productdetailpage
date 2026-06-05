# 진행상황 요약 (작업 핸드오프)

> 이 문서는 **작업 종료 시마다 갱신**한다. 다음 세션이 이 문서만 읽고 바로 이어서 작업할 수 있도록 유지한다.
> 상세 아키텍처는 `CLAUDE.md`, 운영/콘텐츠 정책은 `AGENTS.md` 참고.

**마지막 갱신:** 2026-06-05

---

## 1. 한 줄 상태

관리자 수업 일정 등록 → 고객 페이지 동적 달력 노출 → 모달 예약 → 관리자 선착순/일괄 처리까지 **구현·배포·검증 완료**. 공개 운영 직전 단계.

## 2. 이번까지 완료한 기능

- **관리자 수업 일정 CRUD** (`admin.html` + `admin-reservations` Edge Function)
  - 등록/수정/공개토글/삭제. `createClass`/`updateClass`/`deleteClass` 액션.
  - 목록은 raw `classes` 테이블을 읽어 숨김·비공개 수업까지 관리자에 표시.
- **고객 페이지 동적 달력** (`index.html`)
  - 하드코딩 제거, Supabase `class_reservation_summary`로 어느 달이든 동적 생성. 폴백 `data/classes.json`.
  - 관리자가 등록하면 자동 노출.
- **예약 신청 모달** (`index.html`)
  - 달력 날짜 클릭 → 스크롤 대신 모달 팝업(배경/X/ESC 닫기, 성공 시 자동 닫힘). 달력 칸은 `<button>`.
- **관리자 일괄 처리** (`admin.html`)
  - 행 앞 체크박스 + 전체선택 → 상단 액션바에서 결제 안내 대상 지정/결제 완료/대기/취소 일괄 적용.
  - `선착순 일괄 승인`(`bulkApprove` 액션): 예약 가능 인원 − 확정 인원 만큼 선착순 결제 안내 대상 지정, 초과분 자동 대기(waitlist_order 부여).
  - `구분` 컬럼: 선착순/대기/확정/취소 배지(신청 시간순).
- **문구/UI 정리**
  - 상세/결제/이메일 페이지 AI 티 윤문 + 줄바꿈(Humanize KR 가이드 적용).
  - 어드민 화면에서 기술 용어 제거(Supabase/ADMIN_PASSWORD_HASH 등은 개발자용 JS 주석으로만).
  - 예약 현황 표 줄바꿈 방지(whitespace-nowrap) + text-xs.
- **보안**: `class_reservation_summary` 뷰에 `is_public = true` 필터 추가(비공개 서버단 차단).

## 3. 배포 / 운영 상태

- **GitHub Pages** (main 브랜치 자동 배포). Vercel 등 불필요(순수 정적). canonical `https://baekstrong.github.io/productdetailpage/`.
- **Edge Function `admin-reservations`**: 최신 코드로 배포됨. **반드시 `--no-verify-jwt`로 배포**(게이트웨이 JWT 검증 끄기 — publishable 키는 JWT 아님, 자체 비밀번호 인증). `supabase/config.toml`에 세 함수 `verify_jwt=false` 명시됨.
- **DB 뷰**: `is_public` 필터 버전이 라이브에 적용 완료(SQL Editor에서 수동 실행함).
- **DB 스키마**: `supabase/schema.sql` 기준. 테이블 변경 없음(현재 기능엔 스키마 변경 불필요).
- **테스트**: `python3 -m unittest tests.test_static_pages` — 11개 통과 유지.

### 환경 메모 (다음 세션이 배포할 때)
- 이 PC에 **Supabase CLI는 brew 설치 실패**(CLT/macOS 26 이슈). 대신 바이너리 직접 설치됨:
  - 경로: `~/.local/share/supabase/supabase` (+ `supabase-go` 동봉). 실행 전 `export PATH="$HOME/.local/share/supabase:$PATH"`.
- **배포에는 로그인 필요**: `supabase login --token <PAT>`. (이전 토큰은 사용자가 폐기함 → 다음 배포 시 새 토큰 재로그인 필요.)
- 배포 명령: `supabase functions deploy admin-reservations --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt`
- 함수 스모크: 틀린 비번 POST → `{"ok":false,"error":"invalid password"}` 401 이면 정상.

## 4. 다음에 할 일 (우선순위)

1. **문자 실발송(Solapi) 구현** — `supabase/functions/solapi-reservations/index.ts`의 `sendSolapi()`가 현재 **스텁**. 실제로 문자가 안 나감. HMAC 인증 헤더 + `POST /messages/v4/send` 구현 + 예약 이벤트(접수/결제안내/여석)와 연결 필요. `SOLAPI_API_KEY/SECRET/SENDER` 시크릿은 `supabase secrets set`.
2. **테스트 데이터 정리** — 라이브 DB에 테스트 신청(이쌍칼/구마적, 06-06)과 테스트 수업(06-13 01:00)이 있음. 실제 오픈 전 admin에서 정리.
3. (선택) 커스텀 도메인 연결.
4. **공개 전 백관장 승인**(AGENTS.md 14항).

## 5. 주의 (회귀 방지)

- 계약 테스트(`tests/test_static_pages.py`)가 특정 문자열 존재/금지를 강제. 문구·마크업 바꾸면 함께 확인.
- 어드민에서 기술 용어 노출 금지(테스트가 요구하는 `Supabase`/`ADMIN_PASSWORD_HASH`/함수경로는 JS 주석·상수로만 유지).
- 시크릿 클라이언트 노출 금지(anon publishable 키만 프론트에).
