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
        self.assertIn("data-class-form", html)
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
        self.assertIn("SOLAPI_API_KEY", solapi)
        self.assertIn("SOLAPI_API_SECRET", solapi)
        self.assertIn("예약 신청 완료 문자", solapi)
        self.assertIn("수업 전 리마인드 문자", solapi)
        self.assertIn("복습 영상은 백관장 수동 발송", solapi)
        self.assertNotIn("review_video", solapi)


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
        self.assertIn("수동 발송", admin)
        self.assertIn("제외:", admin)

        # 서버: message_logs 제공 + 재발송 액션
        self.assertIn("message_logs", admin_fn)
        self.assertIn("resendMessage", admin_fn)
        self.assertIn("action === 'resendMessage'", admin_fn)

    def test_public_submit_reservation_function(self):
        fn = read_page("supabase/functions/submit-reservation/index.ts")
        html = read_page("index.html")
        admin = read_page("admin.html")
        admin_fn = read_page("supabase/functions/admin-reservations/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")
        schema = read_page("supabase/schema.sql")

        # 공개 신청 함수: 동의·번호 검증·중복 차단·접수 문자·service_role
        self.assertIn("privacy_consent", fn)
        self.assertIn("^010\\d{8}$", fn)
        self.assertIn("reservation_status=not.in.(cancelled,no_show)", fn)
        self.assertIn("reservation_received", fn)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", fn)

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


if __name__ == "__main__":
    unittest.main()
