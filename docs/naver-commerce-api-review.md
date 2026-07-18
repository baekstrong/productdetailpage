# 네이버 스마트스토어(커머스API) 결제 자동 연동 검토 (2026-07-18)

> 목적: 고객이 스마트스토어에서 결제하면 관리자가 수동으로 누르는 '결제 완료 처리'를 자동화할 수 있는지 검토.
> 결론만 필요하면 아래 3줄, 상세는 그 아래.

## 결론: 조건부 가능

- 커머스API로 **구매자 이름+휴대폰번호가 포함된 주문 데이터 조회 가능** → 예약 DB(이름+전화) 매칭 자동화 성립.
- 단 **웹훅 없음(폴링만)** + **호출 IP 화이트리스트 필수**인데 Supabase Edge Function은 고정 IP가 없음 → **고정 IP 중계 컴포넌트(저가 상시 서버) 필요**.
- 결제 건수가 적은 현 규모에선 완전 자동화가 과설계일 수 있음 — 도입한다면 "고정 IP 워커 5분 폴링 → 자동 결제완료 처리, 관리자는 예외만 수동"이 현실적.

## 상세

### 경로와 자격
- 공식 경로는 **네이버 커머스API센터**(apicenter.commerce.naver.com) 하나뿐. developers.naver.com 오픈API(로그인·검색 등)로는 판매자 주문 데이터 접근 불가.
- 스토어 **통합매니저 권한**으로 애플리케이션 등록(스토어당 1개, 무료, 별도 심사 없음). 앱 인증 기한이 있어 만료 시 휴면 → 주기적 재인증 필요.

### 인증
- OAuth2 Client Credentials + 전자서명: `client_id_타임스탬프`를 client_secret으로 **bcrypt 해싱 → Base64** 서명 → 토큰 발급 → Bearer 호출. Deno에서 구현 가능한 수준(Solapi HMAC과 유사한 난이도).

### 받을 수 있는 데이터
- `상품 주문 상세 내역 조회`에서 **구매자 이름·휴대폰번호 제공**(마스킹 대상은 네이버 ID뿐).
- **개인정보로 역조회는 불가** — "전화번호로 주문 찾기"가 아니라, `변경 상품 주문 내역 조회`(최근 변경분, 조회 범위 최대 24시간)를 **주기 폴링**해서 받아온 주문을 우리 쪽에서 이름+전화로 대조하는 구조.
- 응답의 휴대폰번호가 실번호인지 안심번호(050)인지는 문서상 확정 못 함 — **착수 시 실제 응답으로 반드시 확인**.

### 이 프로젝트의 걸림돌과 아키텍처
- **호출 IP 화이트리스트 필수(최대 3개)** ↔ Supabase Edge Function은 고정 egress IP 없음 → Edge Function 직접 호출 불가.
- 권장: **고정 IP 워커** (Oracle Cloud Free Tier / Naver Cloud / 소형 VPS 등) 를 IP 등록하고, 크론으로 수 분마다 폴링 → 이름+전화 매칭 → service_role로 `reservations` 결제 상태 갱신(기존 결제완료 문자·후속 예약 트리거 로직 재사용).
- 대안: QuotaGuard/Fixie 같은 고정 IP 프록시 — 유료 외부 의존성이 늘어 이 프로젝트 컨벤션(의존성 최소)과 덜 맞음.

### 도입 시 주의
- 개인정보(구매자 이름·전화) 신규 연동 — 배포 전 백관장 승인 + 개인정보 처리 정책 검토 필요(AGENTS.md 14항).
- 앱 재인증·워커 서버 운영이라는 상시 운영 부담이 새로 생김. 월 결제 몇 건 수준이면 수동 처리 대비 절감 효과가 작다.

### 출처
- 커머스API센터: https://apicenter.commerce.naver.com/ko/basic/main
- 공식 기술지원 GitHub: https://github.com/commerce-api-naver/commerce-api
- 마스킹 범위(네이버 ID만): https://github.com/commerce-api-naver/commerce-api/discussions/1542
- 구매자 정보 확인/역조회 불가: https://github.com/commerce-api-naver/commerce-api/discussions/1634
- 상품 주문 상세 조회: https://github.com/commerce-api-naver/commerce-api/discussions/1637
- 전체조회 불가·24시간 제한: https://github.com/commerce-api-naver/commerce-api/discussions/2947
- 주문 수집 API 가이드: https://github.com/commerce-api-naver/commerce-api/discussions/1875
