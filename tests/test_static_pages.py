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
        self.assertIn("8156", plan)
        self.assertIn("HTML/JS에 직접 박아 넣지 않는다", plan)
        self.assertIn("ADMIN_PASSWORD_HASH", plan)

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


if __name__ == "__main__":
    unittest.main()
