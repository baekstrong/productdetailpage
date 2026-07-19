import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_page(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


class StaticPageTests(unittest.TestCase):
    def test_homepage_keeps_original_detail_page_sales_content(self):
        html = read_page("index.html")

        self.assertIn("케틀벨, 혼자 시작하기", html)
        self.assertIn("하루 만에 기본기와 방향부터", html)
        self.assertIn("이런 분께 추천합니다", html)
        self.assertIn("이 수업에서 얻는 것", html)
        self.assertIn("왜 이 수업이 필요한가", html)
        self.assertIn("수업 내용", html)
        self.assertIn("한 번 듣고 끝나지 않습니다", html)
        self.assertIn("이 수업의 차별점", html)
        self.assertIn("수업 정보", html)
        self.assertIn("9만원", html)
        self.assertIn("근력학교 고대점", html)

    def test_homepage_adds_customer_facing_reservation_schedule_without_internal_terms(self):
        html = read_page("index.html")

        self.assertIn("예약 가능 일정", html)
        self.assertIn("calendar-grid", html)
        self.assertIn("data-reservation-date", html)
        self.assertIn("fetch", html)
        self.assertIn("renderScheduleFromClasses", html)
        self.assertIn("예약 신청하기", html)
        self.assertIn("data-public-calendar", html)
        self.assertIn("submitReservationToSupabase", html)
        self.assertIn("name=\"applicant_name\"", html)
        self.assertIn("name=\"phone\"", html)
        self.assertNotIn("name=\"email\"", html)
        self.assertIn("name=\"kettlebell_experience\"", html)
        self.assertIn("name=\"reason\"", html)
        self.assertIn("privacy_consent", html)
        self.assertIn("functions/v1/submit-reservation", html)
        self.assertNotIn("rest/v1/reservations", html)
        self.assertIn("예약 가능 인원", html)
        self.assertIn("대기 인원", html)
        self.assertIn("날짜를 선택하면 예약 신청 화면으로 이동합니다", html)
        self.assertIn("data-month-prev", html)
        self.assertIn("data-month-today", html)
        self.assertIn("data-month-next", html)
        self.assertIn("aria-label=\"이전달\"", html)
        self.assertIn(">오늘</button>", html)
        self.assertIn("aria-label=\"다음달\"", html)
        # Calendar is rendered dynamically from Supabase classes (no hardcoded month panels).
        self.assertIn("id=\"calendar-body\"", html)
        self.assertIn("renderMonth", html)
        self.assertIn("loadClasses", html)
        self.assertNotIn("data-month-panel", html)
        self.assertNotIn("다다음달", html)
        self.assertNotIn("달력형 예약", html)
        self.assertNotIn("Solapi", html)
        self.assertNotIn("SMS FLOW", html)
        self.assertNotIn("운영 예시", html)
        self.assertNotIn("관리자 화면", html)
        self.assertNotIn("백관장", html)
        # 예약 오픈 예정(미리보기) 분기
        self.assertIn("data-preview-open", html)
        self.assertIn("is_open", html)
        self.assertIn("예약 오픈", html)
        # 공휴일 표시
        self.assertIn('src="holidays.js"', html)
        self.assertIn("holidayName", html)

    def test_class_info_shows_next_one_day_class_schedule(self):
        html = read_page("index.html")

        # 수업 정보는 하드코딩 대신 Supabase 일정으로 동적 표시한다.
        self.assertIn('id="next-class-schedule"', html)
        self.assertIn('id="next-class-availability"', html)
        self.assertIn('id="next-class-place"', html)
        self.assertIn("renderNextClassInfo", html)
        self.assertNotIn("6월 6일(토)", html)
        self.assertNotIn("대기 인원 14명", html)
        self.assertNotIn("5월 25일(월) 오후 1~4시", html)

    def test_admin_schedule_management_plan_exists(self):
        plan = read_page("docs/admin-schedule-management-plan.md")

        self.assertIn("관리자 예약 일정 설정 기능 개발 계획", plan)
        self.assertIn("일정 생성", plan)
        self.assertIn("예약 가능 인원", plan)
        self.assertIn("대기 인원", plan)
        self.assertIn("달력 공개/비공개", plan)
        self.assertIn("4차 구현", plan)
        self.assertIn("Solapi 문자 자동 예약", plan)
        self.assertIn("예약 신청 완료 문자", plan)
        self.assertIn("결제 안내 문자", plan)
        self.assertIn("수업 전 리마인드 문자", plan)
        self.assertIn("수업 후 복습 자료 문자", plan)
        self.assertIn("보안 전제", plan)
        self.assertIn("개인정보가 서버에 저장", plan)
        self.assertIn("서버/DB 후보 검토", plan)
        self.assertIn("Supabase", plan)
        self.assertIn("관리자 비밀번호 정책", plan)
        self.assertIn("초기 비밀번호는 별도 Secret으로 관리", plan)
        self.assertIn("HTML/JS와 저장소에 직접 박아 넣지 않는다", plan)
        self.assertIn("ADMIN_PASSWORD_HASH", plan)
        self.assertNotIn("8156", plan)
        self.assertIn("Supabase 무료 플랜", plan)
        self.assertIn("서버 선택 최종안", plan)
        self.assertIn("관리자 상황표", plan)
        self.assertIn("수업일별 예약/신청 현황", plan)
        self.assertIn("어떤 수업일에 누가 예약해서 신청", plan)
        self.assertIn("휴대폰 번호 마스킹", plan)
        self.assertIn("결제 완료 처리", plan)

    def test_reservation_guidance_uses_customer_language(self):
        html = read_page("index.html")

        self.assertIn("예약 안내", html)
        self.assertIn("수업을 예약해주시면, 아래와 같이 진행됩니다", html)
        self.assertIn("문자로 결제 안내", html)
        self.assertIn("결제까지 완료되어야 수업 자리가 확정", html)
        self.assertIn("복습용 교재 링크", html)
        self.assertNotIn("문자 중심으로 진행됩니다", html)
        self.assertNotIn("메일보다 빠른 문자", html)
        self.assertNotIn("자동 문자는", html)

    def test_faq_is_fully_expanded_not_details_collapsed(self):
        html = read_page("index.html")

        self.assertIn("Q. 원하는 날짜를 선택할 수 있나요?", html)
        self.assertIn("Q. 예약 대기 신청하면 바로 결제해야 하나요?", html)
        self.assertIn("Q. 여석이 생기면 어떻게 되나요?", html)
        self.assertNotIn("<details", html)
        self.assertNotIn("<summary", html)

    def test_checkout_page_preserves_payment_conversion_copy(self):
        html = read_page("checkout.html")

        self.assertIn("네이버 스마트스토어에서 신청하기", html)
        self.assertIn("https://smartstore.naver.com/easystrength101/products/9825334073", html)
        self.assertIn("케틀벨, 혼자 시작하기", html)
        self.assertIn("3시간", html)
        self.assertIn("9만원", html)

    def test_admin_page_implements_supabase_protected_schedule_and_status_table(self):
        html = read_page("admin.html")

        self.assertIn("관리자 모드", html)
        self.assertIn("비밀번호", html)
        self.assertIn("ADMIN_PASSWORD_HASH", html)
        self.assertIn("Supabase", html)
        self.assertIn("data-admin-login", html)
        self.assertIn("data-reservation-table", html)
        self.assertIn("수업일별 예약/신청 현황", html)
        self.assertIn("휴대폰 번호 마스킹", html)
        self.assertIn("결제 완료 처리", html)
        self.assertIn("대기 순번 조정", html)
        self.assertNotIn("admin-auth", html)
        self.assertIn("supabase/functions/admin-reservations", html)
        self.assertIn("supabase/functions/solapi-reservations", html)
        self.assertIn("loadAdminData", html)
        self.assertIn("callAdminApi", html)
        self.assertIn("updateReservationStatus", html)
        self.assertIn("renderReservations", html)
        self.assertNotIn("localStorage", html)
        self.assertNotIn("홍길동", html)
        self.assertNotIn("김철수", html)
        self.assertNotIn("demoReservations", html)
        self.assertNotIn("8156", html)
        self.assertNotIn("service_role", html)

    def test_admin_calendar_ui(self):
        html = read_page("admin.html")
        # 월간 캘린더
        self.assertIn('id="admin-cal-body"', html)
        self.assertIn("renderAdminCalendar", html)
        self.assertIn("data-cal-date", html)
        self.assertIn("data-cal-class", html)
        # 오늘 날짜 표기(파란 pill)
        self.assertIn("isToday", html)
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
        # 예약 오픈 일시 입력 + 시각 변환 헬퍼
        self.assertIn("modal-class-open-at", html)
        self.assertIn("modal-class-preview", html)
        self.assertIn('type="datetime-local"', html)
        self.assertIn("inputToOpenAtIso", html)
        self.assertIn("openAtToInput", html)
        self.assertIn('src="holidays.js"', html)
        self.assertIn("holidayName", html)

    def test_admin_reservations_edge_function_protects_private_reads(self):
        edge = read_page("supabase/functions/admin-reservations/index.ts")

        self.assertIn("ADMIN_PASSWORD_HASH", edge)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", edge)
        self.assertIn("action === 'list'", edge)
        self.assertIn("action === 'updateReservation'", edge)
        self.assertIn("public.class_reservation_summary", edge)
        self.assertIn("public.reservations", edge)
        self.assertIn("timingSafeEqual", edge)
        self.assertNotIn("8156", edge)

    def test_supabase_schema_and_edge_functions_are_documented(self):
        schema = read_page("supabase/schema.sql")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")

        self.assertIn("create table if not exists public.classes", schema)
        self.assertIn("create table if not exists public.reservations", schema)
        self.assertIn("alter table public.classes enable row level security", schema)
        self.assertIn("alter table public.reservations enable row level security", schema)
        self.assertIn("ADMIN_PASSWORD_HASH", admin_fn)
        self.assertIn("crypto.subtle.digest", admin_fn)
        self.assertIn("open_at", admin_fn)
        self.assertIn("preview_before_open", admin_fn)
        self.assertIn("is_open", admin_fn)
        self.assertIn("payment_reminder_sent_at", admin_fn)
        self.assertIn("SOLAPI_API_KEY", solapi)
        self.assertIn("SOLAPI_API_SECRET", solapi)
        self.assertIn("예약 신청 완료 문자", solapi)
        self.assertIn("수업 전 리마인드 문자", solapi)
        self.assertIn("복습 영상 안내 문자", solapi)
        self.assertIn("review_video", solapi)


    def test_sms_automation_seat_reminder_review_and_cancel(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")

        # 관리자 '여석 안내' 액션
        self.assertIn('data-bulk-action="seat-opened"', admin)
        self.assertIn("여석 안내", admin)
        self.assertIn("'seat-opened'", admin)

        # 예약 등록(리마인드/복습) + 여석 안내 오버라이드 + 취소 연동
        self.assertIn("seat_opened", admin_fn)
        self.assertIn("class_reminder", admin_fn)
        self.assertIn("review_material", admin_fn)
        self.assertIn("kstReminderSchedule", admin_fn)
        self.assertIn("kstReviewSchedule", admin_fn)
        self.assertIn("scheduleFollowups", admin_fn)
        self.assertIn("cancelScheduledFollowups", admin_fn)
        self.assertIn("cancelGroupId", admin_fn)
        self.assertIn("status=eq.scheduled", admin_fn)

        # solapi 예약 취소 엔드포인트 + groupId 반환
        self.assertIn("cancelGroupId", solapi)
        self.assertIn("/schedule", solapi)
        self.assertIn("groupId", solapi)
        self.assertIn("scheduledDate", solapi)

        # Task 2: 운영자 결제 리마인더 템플릿
        self.assertIn("admin_payment_reminder", solapi)
        self.assertIn("7일 앞입니다", solapi)


    def test_message_status_dashboard(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")

        # 현황판 마크업/함수
        self.assertIn("문자 발송 현황", admin)
        self.assertIn('id="message-status-rows"', admin)
        self.assertIn("summarizeMessageStatus", admin)
        self.assertIn("renderMessageStatus", admin)
        self.assertIn("data-resend-type", admin)
        self.assertIn("reservation_received", admin)
        self.assertIn("reservation_cancelled", admin)
        self.assertIn("data-send-video", admin)
        self.assertIn("제외:", admin)

        # 서버: message_logs 제공 + 재발송 액션
        self.assertIn("message_logs", admin_fn)
        self.assertIn("resendMessage", admin_fn)
        self.assertIn("action === 'resendMessage'", admin_fn)

        # 발송 시각 표기: 서버가 sent_at을 내려주고, 현황판이 KST 날짜·시간으로 표기
        self.assertIn("scheduled_at,sent_at", admin_fn)
        self.assertIn("sentLabel", admin)
        self.assertIn("발송</span>", admin)

        # 발송 본문 확인: 발송 시 body 저장(message_logs) + 현황판 클릭 → 본문 모달
        schema = read_page("supabase/schema.sql")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")
        self.assertIn("add column if not exists body", schema)
        self.assertIn("phoneMasked: maskPhone(phone), text", solapi)
        self.assertIn("sent_at,body", admin_fn)
        self.assertIn('id="log-modal"', admin)
        self.assertIn("showLogDetail", admin)
        self.assertIn("data-log-detail", admin)

    def test_public_submit_reservation_function(self):
        fn = read_page("supabase/functions/submit-reservation/index.ts")
        html = read_page("index.html")
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")
        schema = read_page("supabase/schema.sql")

        # 공개 신청 함수: 동의·번호 검증·중복 차단·접수 문자(정원 내/만석 2분기)·service_role
        self.assertIn("privacy_consent", fn)
        self.assertIn("^010\\d{8}$", fn)
        self.assertIn("reservation_status=not.in.(cancelled,no_show)", fn)
        self.assertIn("reservation_success", fn)
        self.assertIn("reservation_waitlist", fn)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)

        # 접수 문자 2분기 템플릿이 solapi에 존재
        self.assertIn("reservation_success", solapi)
        self.assertIn("reservation_waitlist", solapi)
        self.assertIn("수강 대기 신청이 완료되었습니다", solapi)

        # 프론트는 함수 호출만, 직접 insert 금지
        self.assertIn("functions/v1/submit-reservation", html)
        self.assertNotIn("rest/v1/reservations", html)

        # 어드민: 메모 편집 + 결제 안내 중 배지
        self.assertIn("data-memo-edit", admin)
        self.assertIn("결제 안내 중", admin)

        # 서버: 일괄승인 재클릭 가드 + 취소 문자 + 메모만 수정 시 미발송 가드
        self.assertIn("paymentTargetCount", admin_fn)
        self.assertIn("reservation_cancelled", admin_fn)
        self.assertIn("statusChanged", admin_fn)

        # 문자: 취소 템플릿 + 내부(service_role) 인증
        self.assertIn("예약 취소 안내 문자", solapi)
        self.assertIn("isInternalCall", solapi)

        # 스키마: anon insert 정책 제거 + 중복 방지 인덱스
        self.assertIn("reservations_active_unique", schema)
        self.assertNotIn("anon can create reservation", schema)

        # 중복 정책: 같은 수업은 (class_id,phone) 유니크로 차단, 다른 날짜는 '선착순 자리'만 앱에서 차단(대기는 허용).
        self.assertIn("reservations (class_id, phone)", schema)
        self.assertIn("reservation_status=in.(applied,payment_target,confirmed)", fn)  # 선착순 blocker 조회
        self.assertIn("willWaitlist", fn)                                              # 대기/선착순 판정
        self.assertIn("'waitlisted' : 'payment_target'", fn)                           # 신청 시점 판정을 상태에 반영(즉시 결제 전환)
        # 어드민: 선착순/확정 중복만 집계(대기 제외), 배지 클릭 시 날짜·순위 상세
        self.assertIn("activeReservationsByPhone", admin)
        self.assertIn("data-dup-phone", admin)
        self.assertIn("seatRankLabel", admin)
        # 여석 안내 문자에 '원치 않으면 회신' 안내
        self.assertIn("회신", solapi)
        # 대기 접수 문자에 신청 시점 대기 순위 표기
        self.assertIn("대기 {waitlist_rank}순위", solapi)
        self.assertIn("waitlist_rank", fn)

        # 오픈 전(open_at 미래) 수업은 예약 거부
        self.assertIn("open_at", fn)
        self.assertIn("아직 예약이 시작되지 않은 수업입니다", fn)

    def test_customer_reservation_lookup(self):
        page = read_page("lookup.html")
        fn = read_page("supabase/functions/lookup-reservation/index.ts")
        index = read_page("index.html")

        # 조회 페이지: 이름+전화 입력 폼 + 함수 호출
        self.assertIn("내 예약 조회", page)
        self.assertIn("name=\"applicant_name\"", page)
        self.assertIn("name=\"phone\"", page)
        self.assertIn("functions/v1/lookup-reservation", page)
        self.assertIn("noindex", page)
        # 조회 함수: 이름+전화 일치, 고객 상태 라벨, service_role
        self.assertIn("applicant_name=eq.", fn)
        self.assertIn("phone=eq.", fn)
        self.assertIn("^010\\d{8}$", fn)
        self.assertIn("customerStatusLabel", fn)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)
        # 대기 순번 등 내부 정보는 노출하지 않는다(고객 화면 정책)
        self.assertNotIn("waitlist_order", fn)
        # 공개 페이지에서 조회 진입 링크 제공
        self.assertIn("lookup.html", index)

    def test_google_calendar_sync(self):
        cal = read_page("supabase/functions/admin-reservations/calendar.ts")
        idx = read_page("supabase/functions/admin-reservations/index.ts")
        schema = read_page("supabase/schema.sql")

        # 캘린더 모듈: 서비스계정 JWT(RS256) → OAuth → Calendar REST
        self.assertIn("oauth2.googleapis.com/token", cal)
        self.assertIn("RSASSA-PKCS1-v1_5", cal)
        self.assertIn("GOOGLE_CLIENT_EMAIL", cal)
        self.assertIn("GOOGLE_PRIVATE_KEY", cal)
        self.assertIn("GOOGLE_CALENDAR_ID", cal)
        self.assertIn("calendar/v3/calendars", cal)
        self.assertIn("Asia/Seoul", cal)
        self.assertIn("[케틀벨 원데이]", cal)
        self.assertIn("export async function createEvent", cal)
        self.assertIn("export async function updateEvent", cal)
        self.assertIn("export async function deleteEvent", cal)
        # 시크릿 하드코딩 금지(Deno.env로만)
        self.assertNotIn("BEGIN PRIVATE KEY-----\\nMI", cal)

        # 통합: import + 세 CRUD에서 호출 + event_id 저장
        self.assertIn("from './calendar.ts'", idx)
        self.assertIn("createEvent", idx)
        self.assertIn("updateEvent", idx)
        self.assertIn("deleteEvent", idx)
        self.assertIn("google_event_id", idx)

        # 스키마: 컬럼 추가
        self.assertIn("google_event_id", schema)


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

    def test_payment_reminder_schema(self):
        schema = read_page("supabase/schema.sql")
        self.assertIn("payment_reminder_sent_at timestamptz", schema)
        self.assertIn("add column if not exists payment_reminder_sent_at", schema)


    def test_sms_preview_confirm_and_edit_before_send(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")

        # 관리자: 발송 전 확인/수정 모달 — 실제 본문을 보여주고 확인해야 발송
        self.assertIn('id="sms-modal"', admin)
        self.assertIn('id="sms-modal-text"', admin)
        self.assertIn("confirmSmsBeforeSend", admin)
        self.assertIn("이 내용을 문자로 보내시겠습니까", admin)
        self.assertIn("이 내용으로 발송", admin)
        self.assertIn("messageText", admin)

        # 서버: 미리보기 액션 + 수정 본문(override) 전달
        self.assertIn("action === 'previewMessage'", admin_fn)
        self.assertIn("previewMessage", admin_fn)
        self.assertIn("messageText", admin_fn)
        self.assertIn("overrideText", admin_fn)

        # 문자 없이 처리(silent): 취소 모달의 '문자 없이 처리' 버튼 → 문자 발송/예약 없이 상태만 변경(예약 문자 취소는 수행)
        self.assertIn('id="sms-modal-silent"', admin)
        self.assertIn("문자 없이 처리", admin)
        self.assertIn("SEND_SILENT", admin)
        self.assertIn("Boolean(body.silent)", admin_fn)
        # 본문 무수정 발송은 override 없이 서버 템플릿(수신자별 수업 일정)으로 — 수업 혼재 선택 지원
        self.assertIn("SEND_TEMPLATE", admin)

        # 문자 함수: preview는 발송 없이 본문만 반환, overrideText는 템플릿 대신 발송
        self.assertIn("body.preview", solapi)
        self.assertIn("overrideText", solapi)

        # 직접 작성 문자: 상태 변경 없이 관리자가 쓴 본문만 발송(빈 본문은 서버가 거부)
        self.assertIn('id="custom-sms-button"', admin)
        self.assertIn("직접 작성 문자", admin)
        self.assertIn("handleCustomSms", admin)
        self.assertIn("'custom'", admin_fn)
        self.assertIn("문자 내용이 필요합니다", admin_fn)
        self.assertIn("custom: ''", solapi)
        self.assertIn("text is required", solapi)

        # 템플릿 영구 수정: DB 수정본(message_templates)이 있으면 기본 템플릿 대신 사용, 관리자 모달에서 저장/복원
        schema = read_page("supabase/schema.sql")
        self.assertIn("message_templates", schema)
        self.assertIn("alter table public.message_templates enable row level security", schema)
        self.assertIn("message_templates", solapi)
        self.assertIn("listTemplates", solapi)
        self.assertIn("saveTemplate", solapi)
        self.assertIn("fetchTemplateOverrides", solapi)
        self.assertIn('id="template-modal"', admin)
        self.assertIn("template-edit-button", admin)
        self.assertIn("문자 템플릿 수정", admin)
        self.assertIn("callSolapiApi", admin)
        self.assertIn("기본값 복원", admin)

    def test_payment_deadline_setting_and_block_system(self):
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")
        submit = read_page("supabase/functions/submit-reservation/index.ts")
        schema = read_page("supabase/schema.sql")

        # 예약 거부(차단): 테이블 + 공개 신청 차단 + 관리자 버튼/차단 배지/해제
        self.assertIn("blocked_phones", schema)
        self.assertIn("alter table public.blocked_phones enable row level security", schema)
        self.assertIn("blocked_phones", submit)
        self.assertIn("온라인 예약 신청을 받을 수 없습니다", submit)
        self.assertIn("action === 'blockPhones'", admin_fn)
        self.assertIn("action === 'unblockPhone'", admin_fn)
        self.assertIn('id="block-phone-button"', admin)
        self.assertIn("data-unblock-phone", admin)
        self.assertIn("차단됨", admin)

        # 결제 기한 설정: app_settings + 템플릿 치환자 + 관리자 입력 + '결제 안내 중' 경과 배지 기준
        self.assertIn("app_settings", schema)
        self.assertIn("alter table public.app_settings enable row level security", schema)
        self.assertIn("{payment_deadline_hours}", solapi)
        self.assertIn("fetchAppSetting", solapi)
        self.assertNotIn("24시간", solapi)  # 기한을 템플릿에 하드코딩하지 않는다
        self.assertIn("action === 'saveSetting'", admin_fn)
        self.assertIn("payment_deadline_hours", admin_fn)
        self.assertIn('id="payment-deadline-input"', admin)
        self.assertIn("deadlineHours", admin)
        self.assertIn("h 경과", admin)

    def test_instant_payment_and_deadline_reminder(self):
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")
        submit = read_page("supabase/functions/submit-reservation/index.ts")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        cancel_fn = read_page("supabase/functions/cancel-reservation/index.ts")
        admin = read_page("admin.html")
        html = read_page("index.html")

        # 즉시 결제 전환: 정원 내 신청은 payment_target으로 자리 점유 + 접수 문자에 결제 링크
        self.assertIn("'waitlisted' : 'payment_target'", submit)
        self.assertIn("PAYMENT_LINK", submit)
        self.assertIn("아래 링크에서 결제를 완료하시면 자리가 확정됩니다", solapi)

        # 결제 기한 리마인드는 백관장 요청으로 제거(2026-07-19) — 신규 예약 발송 금지, 잔여 예약분 취소 로직만 유지
        self.assertNotIn("schedulePaymentReminder", admin_fn)
        self.assertNotIn("payment_deadline_reminder", submit)
        self.assertNotIn("remaining_hours", solapi)
        self.assertIn("payment_deadline_reminder", admin_fn)  # cancelScheduledFollowups의 잔여 취소 대상엔 유지
        self.assertIn("cancelScheduledMessages", cancel_fn)

        # 공개 페이지: 즉시 결제 문구로 전환(1주일 전 발송 안내 제거)
        self.assertIn("접수 문자에 결제 링크가 바로", html)
        self.assertNotIn("수업 일주일 전에 발송됩니다", html)

        # 남은 자리 = 정원 - (확정 + 결제 안내 중): 공개 뷰·관리자 집계 공통(결제 안내 중이 자리 점유)
        schema = read_page("supabase/schema.sql")
        self.assertIn("r.reservation_status in ('confirmed', 'payment_target') or r.payment_status = 'paid'", schema)
        self.assertIn("confirmed - paymentReady", admin_fn)

        # 수강생 검색(모든 수업 대상, 이름/전화) — 결제자 대조용
        self.assertIn('id="reservation-search"', admin)
        self.assertIn("searchReservations", admin)
        self.assertIn("data-search-goto", admin)

        # 전체 수강생 보기(수업일 컬럼) + 상태 필터(선착순/결제 안내 중/확정/대기/취소)
        self.assertIn('id="view-all-toggle"', admin)
        self.assertIn("전체 수강생 보기", admin)
        self.assertIn("data-status-filter", admin)
        self.assertIn("reservationCategory", admin)
        self.assertIn("data-th-class-date", admin)
        self.assertIn("allReservationsSorted", admin)
        # 전체 보기에서도 일괄 처리 가능 — 단 문자 나가는 처리는 같은 수업끼리만(수업 혼재 선택 차단)
        self.assertIn("같은 수업의 신청자끼리만 선택하세요", admin)

        # 중복 등록 정리: 다른 수업에서 결제 확정된 번호의 남은 신청에 '취소대상' 배지 + 전용 필터
        self.assertIn("isCancelCandidate", admin)
        self.assertIn("취소대상", admin)
        self.assertIn('data-status-filter="cancel-candidate"', admin)

        # 취소 복구: 취소/불참 건만 대기로 되살림(결제 상태 초기화, 문자 없음) — 활성 신청 강등 방지 가드
        self.assertIn('data-bulk-action="restore"', admin)
        self.assertIn("취소 복구", admin)
        self.assertIn("취소(불참)된 신청만 복구할 수 있습니다", admin)

        # 환불: 공개 페이지 환불 규정 + 관리자 환불 처리 버튼(취소+환불 기록+환불 안내 문자)
        self.assertIn("Q. 결제 후 환불 규정은 어떻게 되나요?", html)
        self.assertIn("수업 시작 전 취소는 전액 환불", html)
        self.assertIn('data-bulk-action="refund"', admin)
        self.assertIn("payment_refunded", admin)
        self.assertIn("payment_refunded", solapi)
        self.assertIn("환불 처리되었습니다", solapi)
        self.assertIn("payment_refunded", admin_fn)

    def test_payment_reminder_function(self):
        fn = read_page("supabase/functions/payment-reminder/index.ts")
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)
        self.assertIn("timingSafeEqual", fn)
        self.assertIn("ADMIN_PHONE", fn)
        self.assertIn("admin_payment_reminder", fn)
        self.assertIn("payment_reminder_sent_at", fn)
        self.assertIn("applied,waitlisted,payment_target", fn)
        self.assertIn("payment_status=neq.paid", fn)
        config = read_page("supabase/config.toml")
        self.assertIn("[functions.payment-reminder]", config)


if __name__ == "__main__":
    unittest.main()
