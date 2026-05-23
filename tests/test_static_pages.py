import json
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
        self.assertIn("data/classes.json", html)
        self.assertIn("fetch", html)
        self.assertIn("renderScheduleFromClasses", html)
        self.assertIn("예약 신청하기", html)
        self.assertIn("data-public-calendar", html)
        self.assertIn("submitReservationToSupabase", html)
        self.assertIn("name=\"applicant_name\"", html)
        self.assertIn("name=\"phone\"", html)
        self.assertIn("name=\"email\"", html)
        self.assertIn("name=\"kettlebell_experience\"", html)
        self.assertIn("name=\"reason\"", html)
        self.assertIn("예약 가능 인원", html)
        self.assertIn("대기 인원", html)
        self.assertIn("날짜를 선택하면 예약 신청 화면으로 이동합니다", html)
        self.assertIn("data-month-panel", html)
        self.assertIn("data-month-prev", html)
        self.assertIn("data-month-today", html)
        self.assertIn("data-month-next", html)
        self.assertIn("aria-label=\"이전달\"", html)
        self.assertIn(">오늘</button>", html)
        self.assertIn("aria-label=\"다음달\"", html)
        self.assertIn("2026년 5월", html)
        self.assertIn("data-today-date=\"2026-05-23\"", html)
        self.assertIn(">23</span>", html)
        self.assertIn("오늘", html)
        self.assertNotIn("다다음달", html)
        self.assertNotIn("달력형 예약", html)
        self.assertNotIn("Solapi", html)
        self.assertNotIn("SMS FLOW", html)
        self.assertNotIn("운영 예시", html)
        self.assertNotIn("관리자 화면", html)
        self.assertNotIn("백관장", html)

    def test_class_info_shows_next_one_day_class_schedule(self):
        html = read_page("index.html")

        self.assertIn("다음 원데이 수업", html)
        self.assertIn("6월 6일(토) 오전 10시~오후 1시", html)
        self.assertIn("예약 가능 인원 6명", html)
        self.assertIn("대기 인원 14명", html)
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
        self.assertIn("supabase/functions/admin-auth", html)
        self.assertIn("supabase/functions/solapi-reservations", html)
        self.assertIn("localStorage", html)
        self.assertIn("data-json-export", html)
        self.assertIn("JSON 내보내기", html)
        self.assertIn("일정 삭제", html)
        self.assertIn("saveClassToSupabase", html)
        self.assertNotIn("8156", html)
        self.assertNotIn("service_role", html)

    def test_classes_json_exists_for_public_calendar(self):
        data = json.loads(read_page("data/classes.json"))

        self.assertIn("classes", data)
        self.assertGreaterEqual(len(data["classes"]), 3)
        first = data["classes"][0]
        self.assertIn("id", first)
        self.assertIn("date", first)
        self.assertIn("capacity", first)
        self.assertIn("confirmed_count", first)
        self.assertIn("waitlist_count", first)
        self.assertIn("is_public", first)

    def test_supabase_schema_and_edge_functions_are_documented(self):
        schema = read_page("supabase/schema.sql")
        auth = read_page("supabase/functions/admin-auth/index.ts")
        solapi = read_page("supabase/functions/solapi-reservations/index.ts")

        self.assertIn("create table if not exists public.classes", schema)
        self.assertIn("create table if not exists public.reservations", schema)
        self.assertIn("alter table public.classes enable row level security", schema)
        self.assertIn("alter table public.reservations enable row level security", schema)
        self.assertIn("ADMIN_PASSWORD_HASH", auth)
        self.assertIn("crypto.subtle.digest", auth)
        self.assertIn("SOLAPI_API_KEY", solapi)
        self.assertIn("SOLAPI_API_SECRET", solapi)
        self.assertIn("예약 신청 완료 문자", solapi)
        self.assertIn("수업 전 리마인드 문자", solapi)
        self.assertIn("복습 영상은 백관장 수동 발송", solapi)
        self.assertNotIn("review_video", solapi)


if __name__ == "__main__":
    unittest.main()
