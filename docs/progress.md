# 진행상황 요약 (작업 핸드오프)

> 이 문서는 **작업 종료 시마다 갱신**한다. 다음 세션이 이 문서만 읽고 바로 이어서 작업할 수 있도록 유지한다.
> 상세 아키텍처는 `CLAUDE.md`, 운영/콘텐츠 정책은 `AGENTS.md` 참고.

> 🆕 **결제 안내 문자 "바로 결제" 유도 + 일괄승인 confirm 문구 정리(2026-06-20)**: ① `solapi-reservations`의 `payment 안내` 템플릿을 결제 즉시 유도형으로 재작성 — 결제 링크를 본문 맨 위(첫 행동 유도 바로 뒤)로 올리고 "결제 완료 순으로 자리가 확정되니 지금 바로 결제해 주세요"로 시작, 마지막 줄에 "그러니 잊지 말고 지금 바로 결제해 주세요" 추가. 24시간은 마감 백업으로 남기되 톤 낮춤(기존엔 "24시간 이내"가 맨 아래라 미룸을 허락하는 구조였음). ② `admin.html` 선착순 일괄 승인 confirm 문구를 "선착순으로 들어온 N명을 '결제 안내 대상'으로 일괄 승인합니다. (정원을 못 채운 나머지는 자동 대기)"로 단순화 — 기존 "초과분은 자동 대기"가 취소자까지 포함하는 것처럼 읽히던 모호함 제거. 동작 변경 없음(bulkApprove는 원래 cancelled/no_show/confirmed 제외). 계약 테스트 16개 PASS. **⚠️ 남은 것: `supabase functions deploy solapi-reservations --no-verify-jwt` 배포 — 이번 세션은 CLI 401(미로그인)로 미배포, 로그인 후 재시도 필요.**

> 🐛 **모바일 캘린더 배지 깨짐 수정(2026-06-19)**: `index.html` 공개 캘린더 날짜 칸이 모바일에서 폭 40px로 좁아 `13:00~16:00` 한 줄 시간 배지가 칸 밖으로 삐져나가던 문제 수정. ① 시간 표기를 모바일만 2줄(`<br class="sm:hidden">`)로, 폰트 `9px`(sm 이상 `11px` 한 줄 복원) ② 카운트 라벨 "예약 가능 N"→"가능 N"·`whitespace-nowrap` ③ 셀/배지에 `overflow-hidden`(옆칸 침범 방지) ④ 모바일 그리드 `gap 6px→4px`, 캘린더 컨테이너 패딩 `p-4→p-2`로 칸 폭 40→44px 확보. Playwright로 iPhone 폭(390)·데스크탑(1100) 양쪽 렌더 검증(모바일 2줄 칸내 정렬, 데스크탑 한 줄 회귀 없음). 프론트만 변경(배포 불필요). 계약 테스트 16개 PASS.

> 🆕 **예약 안내 섹션 개선(2026-06-18)**: `index.html` '예약 안내'를 카드 나열→**세로 타임라인(번호 1~6 + 연결선)**으로 바꾸고 위치를 **캘린더(`#schedule`) 위로** 이동(흐름: hero→예약 안내→예약 가능 일정). 3단계 결제 문구를 "**예약이 확정되면, 문자로 결제 안내를 보내드립니다.**"로 변경(+ "결제까지 완료되어야 수업 자리가 확정됩니다." 유지 — 예약 확정 vs 결제=자리확정 구분, 테스트 의존). 타임라인 아래 **"대기로 신청된 경우"** 안내 박스 추가(정원 차면 대기·자리 나면 순서대로 결제 안내·대기 중 결제 없음, 개인 대기순번은 비노출). 프론트만 변경(배포 불필요, Pages 자동). 계약 테스트 16개 PASS.

> ✅ **관리자 월간 캘린더 UI — 구현 완료(2026-06-15)**: 설계 `docs/superpowers/specs/2026-06-15-admin-calendar-ui-design.md`, 계획 `docs/superpowers/plans/2026-06-15-admin-calendar-ui.md`. 서브에이전트-드리븐으로 Task 1~6 구현, 스펙·코드 품질 리뷰 통과, 계약 테스트 16개 PASS. `admin.html`만 변경(백엔드·DB 무변경). 요지: "일정 선택" 드롭다운 제거→선택 상태를 모듈 변수 `currentClassId`로 관리(`selectedClassId()`→`currentClassId`), 등록/수정 공용 모달(`openClassModal(mode, classItem)`, 인라인 폼 대체), 월간 캘린더(`renderAdminCalendar`/`admin-cal-body` — 칸에 시간·상태·신청현황 배지, 빈날짜 클릭→등록 모달/수업 배지 클릭→수정·삭제 모달, ‹/오늘/›/＋새수업), 목록 표 행 클릭→수업 선택+하이라이트(`setSelectedClass`/`data-select-class`). **남은 것: 라이브 배포는 GitHub Pages 자동(push 시) — 백관장 실제 화면 확인.**

> 🆕 **관리자 결제 24시간 경과 배지(2026-06-16)**: `admin.html` 예약 표 '결제' 셀에 결제 안내/여석 안내 문자(`payment 안내`/`seat_opened`, status=sent) 발송 후 24시간 지났는데 미결제(payment_target/sent, paid·cancelled·confirmed 아님)면 `Nh 경과` amber 배지 표시(`paymentSentAt`/`paymentOverdueHtml`, message_logs 기반). **자동 마감 아님** — 표시만, 마감은 기존 '미결제 마감' 버튼으로 백관장 수동. `payment_expired` 문자는 원래부터 수동(버튼)이라 변경 없음. 프론트만 변경(배포 불필요, Pages 자동).

> 🆕 **결제 링크 발송 시점 안내(2026-06-16)**: "결제 링크는 수업 약 1주일 전에 문자로 발송" 문구를 조회 페이지(applied/waitlisted 안내)와 안내 문자(`reservation_success`/`reservation_waitlist`) 양쪽에 반영. **lookup-reservation/cancel-reservation/solapi-reservations 3개 라이브 배포 완료**(npx supabase, SUPABASE_ACCESS_TOKEN 환경변수). 조회 페이지 4개 상태 렌더 캡처로 확인. ⚠️ 사용한 PAT 채팅 노출 — 대시보드에서 폐기 권장.

> 🆕 **내 예약 조회 보강 + 본인 취소 — 코드 완료(2026-06-16, 배포 완료)**: `lookup.html`이 상태별 안내 문구(다음 행동), 신청일, 확정자 준비물, **예약 취소 버튼**(결제 전 상태만)을 표시. `lookup-reservation`이 `reservation_id`/`status_key`/`created_at`/`cancellable`를 추가 반환(`customerStatusLabel`은 key 기반으로 리팩터, 라벨 동일). 신규 공개 함수 **`cancel-reservation`**: 이름+전화+예약ID 일치 & 결제 완료 전(`payment_status != paid`, status in applied/waitlisted/payment_target)일 때만 PATCH로 cancelled 처리 + 취소 문자(베스트에포트). 결제 링크는 페이지에 버튼 없이 "승인 후 문자로 발송"만 안내. 예약 완료 문자(`reservation_success`/`reservation_waitlist`)도 "신청 승인 후 결제 링크를 문자로 보내드립니다"로 수정. `config.toml`에 `cancel-reservation verify_jwt=false` 추가. **DB 무변경**(cancelled 상태 기존). **남은 것: `supabase functions deploy cancel-reservation/lookup-reservation/solapi-reservations --no-verify-jwt` 배포 + 실문자 확인.** 계약 테스트 16개 PASS.

**마지막 갱신:** 2026-06-20 (**결제 안내 문자 "바로 결제" 유도 + 일괄승인 confirm 문구 정리** — 위 참조. ⚠️ solapi-reservations 배포 미완(CLI 미로그인). 이전: 2026-06-19 **모바일 캘린더 시간 배지 깨짐 수정** — 위 참조. 이전: 2026-06-18 **예약 안내 섹션 타임라인화 + 캘린더 위로 이동, 결제/대기 문구 보강** — 위 참조. 이전: 2026-06-16 **내 예약 조회 보강 + 본인 취소** — 위 참조. 이전: 2026-06-15 **관리자 월간 캘린더 UI 구현 완료** — 아래 참조. 이전 같은 날: **구글 캘린더 동기화 — 배포·검증 완료**: 수업 생성/수정/삭제 시 `admin-reservations`가 구글 Calendar v3 이벤트를 베스트 에포트로 생성·갱신·삭제(`calendar.ts`, 서비스계정 JWT(RS256)→OAuth→REST Deno 직접 호출). `classes.google_event_id` 컬럼·시크릿 3개(`GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID`, 근력학교 앱과 동일 서비스계정·캘린더 재사용) 라이브 적용 완료. 이벤트 제목 `[케틀벨 원데이] M월 D일 (요일)`, **파란색 colorId 9**(근력학교 일정과 구분). 기존 수업 일괄 등록 버튼(`backfillCalendar`). **결제완료 예약 있는 수업 삭제 방어**(force 재확인 필요). 실제 캘린더 생성/색상 검증 완료(아이폰 기본 캘린더는 캘린더색으로 덮어 보일 수 있음 — 구글 캘린더 앱/웹에선 파랑 정상).) (이전: 1차 + 운영 피드백 다수 반영·배포 완료 — 예약 문자 버그 수정(`send-many/detail`+ISO8601), 취소 시 자리 복구(취소·불참 집계 제외), 접수 문자 2분기(정원 내/만석), 본인 예약 조회 페이지(`lookup.html`+`lookup-reservation`), 어드민 기본 시간 13:00~16:00, 현황판 실제 이름 표시, 상단 새로고침 버튼.)

> **공개 직전 체크리스트(미완 추정 — 확인 필요)**: ① 라이브 뷰 SQL 적용(`class_reservation_summary` 취소 제외 — 미적용 시 고객 달력 인원 부정확) ② 테스트 데이터 정리(`delete from message_logs; delete from reservations;`) ③ 노출된 Supabase PAT 폐기 ④ 공개 전 백관장 승인(AGENTS.md 14항 — 운영자 본인 최종 검토).

> 문자 템플릿 정책: `[근력학교]` 접두어 없음(LMS 제목 '케틀벨 원데이 수업'). 결제 마감은 **24시간 고정 문구**("안내 문자를 받은 뒤 24시간 이내")로, 시각 입력 없이 운영. AGENTS.md 9항 톤(여러 줄) 반영. 결제 안내/확정 문자는 수업별 `{장소}`까지 채움.

---

## 1. 한 줄 상태

관리자 수업 일정 등록 → 고객 페이지 동적 달력 노출 → 모달 예약(공개 `submit-reservation` 함수 경유, anon 직접 insert 차단) → 접수/결제안내/여석/확정/리마인드/복습/취소 문자 자동화 → 관리자 선착순·일괄 처리·문자 현황판까지 **구현·배포·검증 완료**. 남은 건 실발송 수동 검증·테스트 데이터 정리·공개 승인뿐.

## 2. 이번까지 완료한 기능

- **관리자 월간 캘린더 UI — 구현 완료(2026-06-15)** (`admin.html` + `tests/test_static_pages.py`, 백엔드·DB 무변경)
  - "일정 선택" 드롭다운(`class-filter`) 제거 → 선택 상태를 모듈 변수 `currentClassId`로 단일화(`selectedClassId()`가 이를 반환). 기본 선택은 가장 가까운 다음 일정.
  - 등록/수정 **공용 모달**(`class-modal`, `openClassModal('create'|'edit', classItem)`): 인라인 등록 폼 대체. 저장은 `createClass`/`updateClass`, 삭제는 결제완료 예약 방어(force 재확인) 그대로. 배경/X/ESC 닫기.
  - **월간 캘린더**(`admin-cal-body`/`renderAdminCalendar`): 날짜 칸에 수업 배지(시간 `13:00~16:00`·상태 라벨·신청현황 `확정 N·가능 M·대기 K`, 상태별 색, 비공개는 흐리게). 빈 날짜 클릭→등록 모달(날짜 프리필), 수업 배지 클릭→수정/삭제 모달. ‹/오늘/›/＋새수업 버튼으로 월 이동·등록.
  - **목록 표 행 선택**: 행 클릭(`data-select-class`)→`setSelectedClass(id)`로 아래 요약·예약표·문자현황 갱신 + 선택 행 하이라이트(`bg-blue-50 ring-2 ring-blue-300`). 관리 버튼(수정/공개토글/삭제)은 기존 동작 유지(버튼 우선 처리로 행 선택과 분리).
  - 서브에이전트-드리븐 구현(Task 1~6) + 스펙/코드 품질 리뷰 통과. 계약 테스트 `test_admin_calendar_ui` 추가, 제거된 `data-class-form` 검사 삭제 — 16개 PASS.
- **구글 캘린더 동기화 — 구현·배포·검증 완료(2026-06-15)** (`admin-reservations/calendar.ts` 신규 + `index.ts` + `admin.html` + `schema.sql`)
  - 수업 등록→이벤트 생성, 수정→갱신, 삭제→제거. 베스트 에포트(시크릿 미설정/캘린더 실패해도 수업 CRUD 정상).
  - Deno에서 서비스계정 JWT(RS256)→OAuth(`oauth2.googleapis.com/token`)→Calendar v3 REST 직접 호출. 근력학교 앱과 **같은 서비스계정·같은 캘린더** 재사용(시크릿 3개 라이브 설정 완료). 토큰 메모리 캐시. private key는 `\n` 복원 후 DER 디코드.
  - `classes.google_event_id` 컬럼으로 수업↔이벤트 연결(라이브 DB 적용 완료). `pickClassFields`가 클라 주입 차단.
  - 이벤트: 제목 `[케틀벨 원데이] M월 D일 (요일)`, 시간 `Asia/Seoul`(자정 넘김 시 종료일 +1), 장소·예약링크, **colorId 9(파랑)**.
  - **일괄 등록 버튼**(`backfillCalendar` 액션): `google_event_id` 없는 기존 수업을 한 번에 캘린더 등록(멱등 — 재실행 안전).
  - **삭제 방어**: 결제완료(confirmed/paid) 예약 있는 수업은 `deleteClass`가 차단, `force:true`(관리자 재확인) 시에만 삭제.
  - 설계/계획: `docs/superpowers/specs/2026-06-14-google-calendar-sync-design.md`, `docs/superpowers/plans/2026-06-14-google-calendar-sync.md`.
- **스키마/테스트 배치 — 코드 완료(2026-06-13, 라이브 DB 미반영)** (`supabase/schema.sql` + `tests/test_static_pages.py`)
  - `anon can create reservation` insert 정책 삭제 — 예약 신청은 submit-reservation(service_role) 경유만 허용.
  - 부분 unique 인덱스 `reservations_active_unique` 추가: `(class_id, phone)` where `reservation_status not in ('cancelled','no_show')` — 같은 수업·같은 번호 활성 신청 중복을 DB 차원에서 차단.
  - 시드 insert 위에 "예시 시드(날짜는 과거일 수 있음, 운영 DB에는 적용하지 말 것)" 주석 추가.
  - 계약 테스트 `test_public_submit_reservation_function` 추가(submit-reservation 검증·프론트 직접 insert 금지·어드민 메모편집·일괄승인 가드·취소 템플릿·내부 인증·스키마 정책/인덱스) — 총 13개 통과.
  - **주의: 라이브 DB에는 아직 미적용.** SQL Editor에서 `drop policy "anon can create reservation" on public.reservations;` + unique index 생성 구문을 실행해야 함(전체 schema.sql 재실행 금지 — 시드 포함).
- **프론트 개편 배치 — 코드 완료(2026-06-13)** (`index.html` + `admin.html` + 계약 테스트)
  - `index.html` 신청 폼: 이메일 입력 삭제, 개인정보 수집·이용 동의 체크박스(필수) 추가. `submitReservationToSupabase()`가 anon REST insert 대신 `functions/v1/submit-reservation` 호출 — 서버의 한글 오류 메시지(`error.serverMessage`)를 그대로 안내, 성공 문구는 "접수 확인 문자를 보내드립니다".
  - 수업 정보 섹션 동적화: `next-class-schedule`/`next-class-availability`/`next-class-place` + `renderNextClassInfo()`가 가장 가까운 다음 일정을 한국어 라벨(`koreanScheduleLabel`)로 표시. 하드코딩 날짜/현황 제거. 다음 일정 없으면 "새 일정 오픈 준비 중".
  - `data/classes.json` 폴백 삭제 — Supabase 실패 시 달력 빈 상태 + "일정을 불러오지 못했습니다. 잠시 후 새로고침해 주세요." 안내.
  - `admin.html`: 이메일 컬럼 제거(colspan 12), 메모 셀이 클릭 → prompt 편집(`admin_memo`만 update — 상태 키 없으니 문자 미발송), 일괄 승인 힌트가 결제 안내 중 인원 차감(`capacity - confirmed - payment_ready`), 문자 현황판에 `reservation_received`(자동화됨)·`reservation_cancelled` 행 추가.
  - 계약 테스트 같은 커밋 수정(이메일 금지·privacy_consent/submit-reservation 요구·classes.json 테스트 삭제 등) — 12개 통과.
- **admin-reservations 동작 개선 — 코드 완료(2026-06-13, 재배포 필요)** (`supabase/functions/admin-reservations/index.ts`)
  - `updateReservation`: 이번 요청이 `reservation_status`/`payment_status`를 실제로 바꿨을 때만 문자 분기 실행(메모만 수정해도 문자가 재발송되던 사고 방지).
  - 취소 처리 시 `reservation_cancelled` 취소 안내 문자 발송 + 예약된 리마인드·복습 취소(미결제 마감은 기존 `payment_expired` 문자 유지).
  - `bulkApprove` 재클릭 가드: 이미 결제 안내를 받은 `payment_target`을 자리 점유로 차감하고 후보에서 제외(중복 문자·초과 승인 방지).
  - `scheduleFollowups`: 발송 시각이 이미 지난 리마인드/복습은 조용히 빠지지 않고 message_logs에 `skipped`로 기록(현황판 노출).
  - `RESENDABLE_TYPES`에 `reservation_received`/`reservation_cancelled` 추가. 함수 간(solapi) 호출은 Bearer service_role 내부 인증이므로 `sendSms`/`notify`/`cancelScheduledFollowups` 체인 전체에서 평문 비밀번호 전달 제거(클라이언트 인증 게이트 `assertAdminPassword`는 유지).
  - `submit-reservation`: 동시 신청 레이스로 unique 인덱스(23505) 위반 시 영어 DB 오류 대신 409 한글 안내("이미 이 수업에 신청되어 있습니다…")로 응답.
  - `submit-reservation`의 `isPastClassKst`: 날짜/시각 파싱 실패 시 '종료된 수업' 오인 차단 대신 명시적 오류 throw.
- **admin-auth 죽은 코드 제거(2026-06-13)** — `supabase/functions/admin-auth/` 삭제(1시간 토큰 발급하나 어디서도 미사용 — admin.html은 매 요청 비밀번호 전송 방식). admin.html의 `authEndpoint` 참조 제거, 계약 테스트 2건 admin-reservations 기준으로 수정. 라이브 함수 삭제는 선택: `supabase functions delete admin-auth --project-ref vjoxzbxcylqyhxezxiuj`. (CLAUDE.md의 admin-auth 언급 정리는 마지막 문서 배치 담당.)
- **공개 신청 엔드포인트 `submit-reservation` 신설 — 코드 완료(2026-06-13, 배포 전)** (`supabase/functions/submit-reservation/index.ts`)
  - 검증(이름·010 11자리·개인정보 동의·class_id) → 신청 가능 수업 확인(공개+숨김 아님+시작 전) → 같은 수업 활성 신청 중복 차단(409) → service_role insert → 접수 확인 문자(베스트 에포트, message_logs 기록).
  - anon 직접 insert를 대체하는 작업의 **서버 측 선행 단계**. index.html 프론트 연동·anon insert 정책 제거·함수 배포는 **다음 배치** 담당.
  - `solapi-reservations` 확장: `reservation_cancelled` 취소 안내 템플릿 추가 + "Authorization: Bearer <service_role key>" 내부 호출이면 관리자 비밀번호 없이 인증 통과(timing-safe 비교).
  - `supabase/config.toml`: `[functions.submit-reservation] verify_jwt=false` 추가, `[functions.admin-auth]` 블록 제거(admin-auth 함수 자체 삭제는 다음 배치).
- **문자 발송 현황판 + 재발송 — 구현·배포 완료(2026-06-07)** (`admin.html` + `admin-reservations`)
  - admin `list`가 `message_logs`를 함께 내려주고, 선택 일정 기준으로 종류별 발송/예약/미발송을 집계해 표시.
  - 전원 성공 시 "전체 발송 완료(N명)"/"전체 예약 완료(N명)", 일부 누락 시 "발송 완료(제외: 이름…)" + [재발송 K명] 버튼.
  - 재발송은 `resendMessage` 액션(즉시형 즉시발송 / 예약형 재예약, 과거 시각이면 skip). 분모=보낸 시도 기준.
  - ✅ admin-reservations 재배포 완료, resendMessage 인증 게이트 스모크 통과(틀린 비번 → 401).
- **문자 자동화 마무리 — 구현·배포 완료(실발송 검증 전)** (`admin.html` + `admin-reservations` + `solapi-reservations`)
  - ✅ 두 함수 `--no-verify-jwt` 재배포 완료(2026-06-07). 인증 게이트 스모크 통과(틀린 비번 → 401). 취소 실패는 message_logs `cancel_failed`로 기록.
  - **여석 안내(수동)**: 관리자 '여석 안내' 일괄 액션 → 대기자에게 여석 안내 문자 발송 + 결제 안내 대상(payment_target/sent) 전환.
  - **수업 전 리마인드 + 수업 후 복습 자료(자동 예약발송)**: '결제 완료 처리' 시 Solapi 예약 발송 등록 — 리마인드=수업 전날 18:00(KST), 복습=수업 종료 시각(KST). cron 없이 Solapi `scheduledDate` 사용.
  - **취소 연동**: '취소 처리'/'미결제 마감' 시 해당 예약의 예약된 리마인드·복습 문자를 Solapi에서 취소(`DELETE .../groups/{groupId}/schedule`).
  - 중복 방지(message_logs status in sent/scheduled 체크), 과거 시각 가드, groupId를 message_logs.provider_message_id에 저장.
- **관리자 수업 일정 CRUD** (`admin.html` + `admin-reservations` Edge Function)
  - 등록/수정/공개토글/삭제. `createClass`/`updateClass`/`deleteClass` 액션.
  - 목록은 raw `classes` 테이블을 읽어 숨김·비공개 수업까지 관리자에 표시.
- **고객 페이지 동적 달력** (`index.html`)
  - 하드코딩 제거, Supabase `class_reservation_summary`로 어느 달이든 동적 생성. (폴백 `data/classes.json`은 2026-06-13 삭제 — 실패 시 안내 문구.)
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
- **지난 수업 처리(프론트 계산, 시작 시각 기준)** (`index.html` + `admin.html`)
  - 공통 헬퍼 `isPastClass(c)`: `class_date`+`start_time`이 현재 시각보다 과거면 종료로 판정(로컬/KST 기준). admin엔 `upcomingClasses()`(시작 전만 가까운 순) 헬퍼도 추가.
  - 고객 달력(`classAnchorHtml`): 지난 수업도 **달력에 그대로 표시하되 '종료'로만 표기**(회색·opacity, `data-reservation-date` 없는 `<div>`라 클릭/예약 불가). 아예 숨기지 않음.
  - 관리자 '일정 선택' 드롭다운: `예정된 수업`(가까운 순) / `종료된 수업`(최근 순) optgroup으로 나눠 **둘 다 선택 가능**(과거 수업도 나중에 조회 가능). 기본 선택은 가장 가까운 **다음 일정**(`renderAdminData`).
  - 관리자 '수업 일정 등록/관리' 표는 종료 수업도 표시(행 muted + `종료` 배지, 기록·삭제용).
  - DB status 변경/cron 없음(YAGNI).
- **고객 달력 수업 시간 표기** (`index.html`): 칸에 `시작~종료`(예: `13:00~16:00`) 표시. `normalizeClass`에 `end_time` 추가 + `timeRange()` 헬퍼(예약가능/대기/종료 칸 공통). end_time 없으면 시작 시각만.
- **자동 문자(Solapi) — 코드 완료** (`solapi-reservations` + `admin-reservations`)
  - `solapi-reservations`: 실제 HMAC-SHA256 발송 구현(스텁 아님). 관리자 비밀번호로 보호(요금 폭탄 방지). 키 없으면 안전 skip.
  - `admin-reservations`: 상태 전환 시 서버사이드 자동 발송 — '결제 안내 대상 지정/일괄 승인' → 결제 안내 문자, '결제 완료' → 확정 문자. `message_logs` 기록(베스트 에포트).
  - ✅ **시크릿 설정·배포 완료(2026-06-05).** 두 함수 `--no-verify-jwt` 라이브. 인증 게이트 스모크 통과. 실제 발송(실문자)만 운영자 번호로 최종 확인하면 끝.

## 3. 배포 / 운영 상태

- **GitHub Pages** (main 브랜치 자동 배포). Vercel 등 불필요(순수 정적). canonical `https://baekstrong.github.io/productdetailpage/`.
- **Edge Function `admin-reservations`**: 최신 코드로 배포됨. **반드시 `--no-verify-jwt`로 배포**(게이트웨이 JWT 검증 끄기 — publishable 키는 JWT 아님, 자체 비밀번호 인증). `supabase/config.toml`에 세 함수 `verify_jwt=false` 명시됨.
- **DB 뷰**: `is_public` 필터 버전이 라이브에 적용 완료(SQL Editor에서 수동 실행함).
- **DB 스키마**: `supabase/schema.sql` 기준. 테이블 변경 없음(현재 기능엔 스키마 변경 불필요).
- **테스트**: `python3 -m unittest tests.test_static_pages` — 16개 통과(관리자 캘린더 UI 계약 테스트 추가).

### 환경 메모 (다음 세션이 배포할 때)
- 이 PC에 **Supabase CLI는 brew 설치 실패**(CLT/macOS 26 이슈). 대신 바이너리 직접 설치됨:
  - 경로: `~/.local/share/supabase/supabase` (+ `supabase-go` 동봉). 실행 전 `export PATH="$HOME/.local/share/supabase:$PATH"`.
- **배포에는 로그인 필요**: `supabase login --token <PAT>`. 토큰은 PC에 저장돼 한 번 로그인하면 폐기 전까지 유지된다(매번 재로그인은 이전 토큰을 폐기했기 때문). 보안상 작업 후 토큰 폐기를 권장하나, 폐기하면 다음 배포 시 재로그인 필요.
- 배포 명령: `supabase functions deploy <fn> --project-ref vjoxzbxcylqyhxezxiuj --no-verify-jwt` (fn = submit-reservation / solapi-reservations / admin-reservations)
- 함수 스모크: 틀린 비번 POST → `401` / submit-reservation 잘못된 번호 → `400` 한글 메시지면 정상.

## 4. 다음에 할 일 (우선순위)

0. **✅ 관리자 월간 캘린더 UI — 구현·테스트 완료(2026-06-15)**. push 시 GitHub Pages 자동 배포. 백관장이 관리자 화면에서 캘린더 등록/수정/삭제·행 선택 동작 실제 확인만 남음.
1. **✅ 1차 구조 개선 — 코드·배포·DB 적용·검증 전부 완료(2026-06-13)**
   - 함수 3개 배포(submit-reservation 신규 + solapi/admin 재배포), 스모크 통과.
   - 라이브 DB: `anon can create reservation` 정책 제거(anon 직접 insert가 RLS 42501로 차단됨을 실제 확인) + `reservations_active_unique` 인덱스 생성 완료. 인덱스 생성 전 중복 활성 신청 1건은 최초만 남기고 취소 처리.
   - (admin-auth 라이브 함수 삭제는 선택 사항으로 남음: `supabase functions delete admin-auth --project-ref vjoxzbxcylqyhxezxiuj`.)
   - ⚠️ 이번 세션에서 `supabase login`에 쓴 PAT가 채팅에 노출됨 — 보안상 대시보드에서 폐기 권장(폐기 시 다음 배포에 재로그인 필요).
2. **문자 자동화 + 현황판 — 구현·배포 완료. 실발송 수동 검증만 남음**
   - 세 Edge Function 모두 최신 코드로 배포됨(2026-06-07). 인증 게이트 스모크 통과.
   - **남은 것(운영자 폰으로):** ① 결제완료 처리 → message_logs에 리마인드·복습 2건 `scheduled` + Solapi 콘솔 예약 2건 / ② 취소 처리 → 두 건 `cancelled` + Solapi 예약 사라짐 / ③ 여석 안내 → 문자 수신 + payment_target 전환 / ④ 현황판에서 발송/예약/제외 표기·재발송 버튼 동작.
3. **테스트 데이터 정리** — 라이브 DB에 테스트 신청(이쌍칼/구마적, 06-06)과 테스트 수업(06-13 01:00)이 있음. 실제 오픈 전 admin에서 정리.
4. (선택) 커스텀 도메인 연결.
5. **공개 전 백관장 승인**(AGENTS.md 14항).

## 5. 주의 (회귀 방지)

- 계약 테스트(`tests/test_static_pages.py`)가 특정 문자열 존재/금지를 강제. 문구·마크업 바꾸면 함께 확인.
- 어드민에서 기술 용어 노출 금지(테스트가 요구하는 `Supabase`/`ADMIN_PASSWORD_HASH`/함수경로는 JS 주석·상수로만 유지).
- 시크릿 클라이언트 노출 금지(anon publishable 키만 프론트에).
