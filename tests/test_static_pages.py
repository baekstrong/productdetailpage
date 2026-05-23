import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_page(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


class StaticPageTests(unittest.TestCase):
    def test_homepage_is_reservation_waitlist_calendar_page(self):
        html = read_page("index.html")

        self.assertIn("원하는 날짜에 예약 대기", html)
        self.assertIn("달력형 예약", html)
        self.assertIn("data-class-date", html)
        self.assertIn("예약 대기 인원", html)
        self.assertIn("예약 대기하기", html)

    def test_homepage_explains_sms_first_solapi_flow(self):
        html = read_page("index.html")

        self.assertIn("Solapi", html)
        self.assertIn("선착순 6명", html)
        self.assertIn("결제 안내 문자", html)
        self.assertIn("여석", html)
        self.assertIn("백관장이 확인", html)
        self.assertIn("복습 영상", html)
        self.assertIn("별도로 발송", html)

    def test_checkout_page_preserves_payment_conversion_copy(self):
        html = read_page("checkout.html")

        self.assertIn("네이버 스마트스토어에서 신청하기", html)
        self.assertIn("https://smartstore.naver.com/easystrength101/products/9825334073", html)
        self.assertIn("케틀벨, 혼자 시작하기", html)
        self.assertIn("3시간", html)
        self.assertIn("9만원", html)

    def test_hosting_metadata_exists_for_github_pages(self):
        html = read_page("index.html")

        self.assertIn("https://baekstrong.github.io/productdetailpage/", html)
        self.assertIn("케틀벨 원데이 수업 예약 대기", html)
        self.assertIn("og:title", html)


if __name__ == "__main__":
    unittest.main()
