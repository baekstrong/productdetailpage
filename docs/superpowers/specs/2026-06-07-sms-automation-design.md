# 문자 자동화 마무리 — 설계 문서

**작성일:** 2026-06-07
**상태:** 승인됨 (구현 대기)

## 목표

현재 동작하는 자동 문자(결제 안내·결제 완료·미결제 마감)에 더해, 남은 안내 문자 자동화를 마무리한다.

이번 범위:
- **#5 여석 안내** — 관리자가 대기자에게 수동으로 "여석 안내" 처리 시 즉시 발송 + 결제 대상 전환
- **#6 수업 전 리마인드** — 결제 완료 시 "수업 전날 18:00(KST)"로 Solapi 예약 발송
- **#7 수업 후 복습 자료** — 결제 완료 시 "수업 종료 시각(KST)"으로 Solapi 예약 발송
- **취소 연동** — 취소/미결제 마감 시 이미 예약된 리마인드·복습 문자를 Solapi에서 취소

범위 제외(YAGNI):
- #4 예약 신청 완료 문자(anon insert → DB 웹훅 필요) — 추후
- cron/GitHub Actions 등 외부 스케줄러 — Solapi 예약 발송으로 대체하여 불필요

## 핵심 아키텍처

새 인프라(cron·웹훅·새 Edge Function) 없음. 기존 3개 파일만 수정한다.

- `admin.html` — "여석 안내" 일괄 액션 버튼 추가, 액션→API 매핑 확장
- `supabase/functions/admin-reservations/index.ts` — 상태 전환 시 예약 발송 등록/취소 로직, notify 오버라이드
- `supabase/functions/solapi-reservations/index.ts` — 예약 발송 응답에 groupId 반환, 예약 취소 분기 추가

DB 스키마 변경 없음. 새 시크릿 없음.

## Solapi 예약 발송 / 취소 API (검증됨)

- **예약 발송:** `POST https://api.solapi.com/messages/v4/send`, 본문에 top-level `scheduledDate` 포함 → 응답에 `groupId`(또는 `groupInfo._id`) 반환.
  - 형식: `"YYYY-MM-DD HH:mm:ss"` (KST 로컬, 예 `"2026-06-12 18:00:00"`).
- **예약 취소:** `DELETE https://api.solapi.com/messages/v4/groups/{groupId}/schedule` (HMAC-SHA256 인증 동일).
- 출처: solapi-nodejs SDK `src/services/messages/groupService.ts`.
- ⚠️ 첫 실발송/예약 테스트 때 응답 groupId 위치와 scheduledDate 형식을 최종 확인한다.

## 상세 동작

### #5 여석 안내 (수동, 즉시)

- `admin.html`: 일괄 액션바에 **"여석 안내"** 버튼(`data-bulk-action="seat-opened"`) 추가.
- 매핑: `seat-opened` → `{ reservation_status: 'payment_target', payment_status: 'sent' }` + notify 오버라이드 `seat_opened`.
- `applyBulkAction`: 확인 다이얼로그("선택한 N명에게 여석 안내 문자를 보낼까요?") 후, 각 건을 `updateReservation({ reservationId, updates, notify: 'seat_opened' })`로 호출.
- `admin-reservations.updateReservation(reservationId, updates, password, notifyOverride?)`:
  - payment_target/sent 분기에서 `notifyOverride === 'seat_opened'`면 `'payment 안내'` 대신 `'seat_opened'` 템플릿 발송.
  - 그 외에는 기존대로 `'payment 안내'`.
- 결과: 대기자 → 결제 안내 대상으로 전환되어 기존 24시간/미결제 마감 흐름과 동일하게 연결.

### #6 리마인드 + #7 복습 (결제 완료 시 예약 등록)

- 트리거: `updateReservation`에서 `reservation_status === 'confirmed' || payment_status === 'paid'`로 전환되는 기존 분기. 즉시 결제 완료 문자 발송 직후 예약 등록을 시도한다.
- 시각 계산(KST):
  - 리마인드 = `(class_date - 1일) 18:00:00`
  - 복습 = `class_date end_time:00` (예 `end_time=16:00` → `class_date 16:00:00`)
- 가드:
  - **과거 시각 skip:** 계산된 시각 ≤ 현재(KST)면 해당 예약 등록 생략(로그 status='skipped').
  - **중복 방지:** `message_logs`에 해당 `reservation_id` + `message_type in (class_reminder, review_material)` + `status in (sent, scheduled)` 행이 이미 있으면 재등록 생략(결제 완료 재클릭 대비).
- 발송 경로: `notify(..., scheduledAt)` → `sendSms(..., scheduledAt)` → `solapi-reservations`(top-level `scheduledDate`).
- 기록: 예약 성공 시 `message_logs`에 `status='scheduled'`, `provider_message_id=groupId` 저장.

### 취소 연동

- 트리거: `updateReservation`에서 `reservation_status === 'cancelled'`(취소 처리) 또는 `payment_status === 'expired'`(미결제 마감)로 전환될 때.
- 절차:
  1. `message_logs`에서 그 `reservation_id`의 `status='scheduled'` + `message_type in (class_reminder, review_material)` 행 조회 → `provider_message_id`(groupId) 수집.
  2. 각 groupId마다 `solapi-reservations`에 취소 요청(`{ password, cancelGroupId }`) → `DELETE .../groups/{groupId}/schedule`.
  3. 취소 성공한 행은 `message_logs.status='cancelled'`로 갱신(베스트 에포트).
- 베스트 에포트: 취소 실패(이미 발송/만료 등)해도 관리자 액션 자체는 막지 않는다.
- 참고: 미결제 마감(expired)은 결제 전 단계라 예약된 문자가 없는 게 보통 → 조회 결과 0건이면 그냥 통과.

### solapi-reservations 변경

- `sendSolapi`가 `scheduledAt`을 받으면 top-level `scheduledDate`로 전달하고, 응답에서 `groupId`(`result.groupId || result.groupInfo?._id`)를 반환.
- 새 분기: 본문에 `cancelGroupId`가 있으면(메시지 발송 대신) 해당 그룹 예약을 `DELETE .../groups/{groupId}/schedule`로 취소하고 결과 반환. 관리자 비밀번호 인증은 동일하게 요구.

## 컴포넌트 경계

- `solapi-reservations`: "문자 1건 보내기 / 예약 발송 / 예약 취소"만 담당(Solapi 통신 캡슐화). 비즈니스 로직 없음.
- `admin-reservations`: 예약 상태 머신 + 어떤 문자를 언제 보내고/예약하고/취소할지 결정. Solapi 호출은 위 함수에 위임.
- `admin.html`: 관리자 액션 UI. 서버에 액션만 전달.

## 에러 처리

- 모든 문자 발송/예약/취소는 베스트 에포트. 실패해도 상태 변경(예약 DB 업데이트)은 성공 처리.
- 실패/skip/취소는 `message_logs`에 status와 `error_message`로 남겨 사후 추적.

## 테스트

- 계약 테스트(`tests/test_static_pages.py`): `admin.html`에 "여석 안내" 액션이 존재하는지 등 마크업 계약 추가/확인.
- 수동 검증:
  1. 결제 완료 처리 → `message_logs`에 `class_reminder`/`review_material` 2건이 `status='scheduled'`, groupId 채워짐. Solapi 콘솔 예약 내역 2건 확인.
  2. 같은 건 취소 처리 → 두 행 `status='cancelled'`, Solapi 예약 내역 사라짐.
  3. 대기자 여석 안내 → 여석 안내 문자 수신 + 상태 payment_target 전환.
  4. 과거 시각/중복 가드: 임박한 수업 결제, 결제 완료 재클릭 시 중복 예약 없음.

## 배포

- `admin-reservations`, `solapi-reservations` 재배포 필요(`--no-verify-jwt`).
- Supabase 재로그인(새 PAT) 필요 — 이전 토큰 폐기됨.
- DB 스키마/시크릿 변경 없음.

## 알려진 한계

- scheduledDate는 KST 기준 문자열로 전송. 서버(Edge Function/Deno)는 UTC이므로 KST 변환을 코드에서 직접 계산한다(+9h).
- Solapi 잔액 부족 시 예약 발송은 발송 시점에 실패 처리됨(Solapi 정책). 운영 중 잔액 관리 필요.
