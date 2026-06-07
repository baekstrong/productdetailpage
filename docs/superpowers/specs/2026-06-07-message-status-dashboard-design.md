# 문자 발송 현황판 + 재발송 — 설계 문서

**작성일:** 2026-06-07
**상태:** 승인됨 (구현 대기)

## 목표

admin.html의 "문자 자동 예약" 정적 안내 목록을, **선택한 일정의 실제 문자 발송 현황판**으로 바꾼다. 종류별로 발송 완료/예약 완료/미발송을 보여주고, 미발송자에게 **재발송 버튼**으로 추가 발송할 수 있게 한다.

## 핵심 결정 (확정)

- **분모 = "보낸 시도" 기준**: 각 문자 종류에 대해, 그 종류를 보낸 시도(message_logs에 로그가 있는)한 사람만 분모로 잡는다. 한 번도 시도 안 한 사람은 현황판에 안 잡힌다(최초 발송은 기존 신청자 표 액션으로).
- **예약(scheduled) 구분 표기**: 아직 발송 전 Solapi 예약 상태는 "예약 완료"로, 실제 발송된 것은 "발송 완료"로 구분.
- **7종 전부 표시**: 자동발송 없는 항목(예약 신청 완료), 수동 항목(복습 영상)도 행으로 두되 고정 문구로 표기.
- **재발송은 현황판 버튼**으로.

## 데이터 흐름

- `admin-reservations`의 `list` 액션 응답에 `message_logs`를 포함한다(필드: `reservation_id`, `message_type`, `status`). 운영 규모가 작아 전체 로그를 내려도 무방하다.
- 프론트(admin.html)는 선택된 일정(`class-filter`)의 예약자 id 집합으로 로그를 필터링해 종류별로 집계한다.
- 일정 선택이 바뀌면 현황판을 다시 렌더한다(`renderAdminData` 흐름에 합류).

## 사람별 상태 우선순위

한 예약자가 같은 종류의 로그를 여러 개 가질 수 있으므로(실패 후 재발송 등), 사람별로 best 상태를 채택한다:

`발송완료(sent) > 예약완료(scheduled) > 취소(cancelled) > 미발송(failed | skipped | cancel_failed)`

## 7행 매핑

| 행 라벨 | message_type 키 | 특수 표기 |
|---|---|---|
| 예약 신청 완료 문자 | (자동발송 없음) | 항상 "자동발송 안 함" |
| 결제 안내 문자 | `payment 안내` | 일반 규칙 |
| 여석 안내 문자 | `seat_opened` | 일반 규칙 |
| 결제 완료 문자 | `payment_completed` | 일반 규칙 |
| 수업 전 리마인드 문자 | `class_reminder` | scheduled → "예약 완료" |
| 수업 후 복습 자료 문자 | `review_material` | scheduled → "예약 완료" |
| 복습 영상 안내 문자 | (수동) | 항상 "수동 발송" |

## 행 요약 규칙 (일반 규칙)

집계 대상 = 해당 종류 로그를 가진 그 일정 예약자. 단 **사람별 best 상태가 `cancelled`인 사람은 행에서 완전히 제외**한다(취소는 의도된 상태 — 분모/성공/제외 어디에도 포함하지 않음). 남은 사람들을 best 상태로 분류:

- **성공군** = best가 `sent`(발송완료) 또는 `scheduled`(예약완료)
- **미발송군** = best가 `failed | skipped | cancel_failed`
- **N** = 성공군 + 미발송군 인원

요약 텍스트:
- **N = 0** → "발송 내역 없음" (회색)
- **미발송군 0, 전원 sent** → "✅ 전체 발송 완료 (N명)"
- **미발송군 0, 전원 scheduled** → "📅 전체 예약 완료 (N명)"
- **미발송군 0, sent+scheduled 혼합** → "발송 X명 · 예약 Y명 (총 N명)"
- **미발송군 존재** → "발송 완료 (제외: 이름1, 이름2)" + **[재발송 K명]** 버튼 (K = 미발송군 인원). 제외 이름 = 그 예약자 `applicant_name`. 재발송/제외 대상 = best가 `failed | skipped | cancel_failed`인 사람만.

## 재발송

- [재발송 K명] 클릭 → confirm 후, 그 종류의 미발송(failed/skipped/cancel_failed) 인원에게 재발송.
- 새 admin 액션 `resendMessage(classId, messageType, reservationIds, password)`:
  - 대상 예약자들을 조회하고, 각자에게 messageType에 맞는 값으로 `notify` 호출.
  - **즉시형**(`payment 안내`, `seat_opened`, `payment_completed`): 즉시 발송. 값 = {class_date: label, place, (payment 안내/seat_opened는 payment_url 추가)}.
  - **예약형**(`class_reminder`, `review_material`): `kstReminderSchedule`/`kstReviewSchedule`로 시각 재계산 → 미래면 scheduledAt으로 재예약, 과거면 skip(로그 skipped).
  - 각 발송 결과는 `message_logs`에 새 로그로 기록(기존 실패 로그는 남되, 사람별 best-status 집계라 성공이 우선 표시됨).
  - 허용 messageType 화이트리스트로 임의 값 차단.
- 프론트: 재발송 후 `loadAdminData()`로 현황 갱신.

## 컴포넌트 경계

- `admin-reservations`: 데이터 제공(list+message_logs) + 재발송 비즈니스 로직. Solapi 호출은 기존 `notify`/`solapi-reservations` 재사용.
- `admin.html`: 현황 집계·표시·재발송 트리거. 집계 로직은 작은 순수 함수(`summarizeMessageStatus`)로 분리해 가독성 유지.

## 에러 처리

- list에 message_logs가 없거나 빈 배열이어도 현황판은 "발송 내역 없음"으로 안전 표시.
- 재발송 실패는 message_logs에 failed로 남고, 현황판에 계속 제외로 표시(베스트 에포트).

## 테스트

- 계약 테스트(`tests/test_static_pages.py`): admin.html에 현황판 마크업/함수(`summarizeMessageStatus`, `data-message-status`, "재발송", "자동발송 안 함", "수동 발송") 존재 확인. admin-reservations에 `resendMessage`·message_logs 포함 확인.
- 수동 검증: 결제완료 처리 → 현황판 결제완료 "전체 발송 완료", 리마인드/복습 "전체 예약 완료". 일부러 실패 유도 어려우면 message_logs를 직접 손봐 제외/재발송 동작 확인.

## 배포

- `admin-reservations` 재배포 필요(`--no-verify-jwt`). admin.html은 정적(GitHub Pages 자동). DB/시크릿 변경 없음.

## 알려진 한계

- "한 번도 보낸 적 없는 사람"은 현황판 분모에 없음(의도). 최초 발송은 신청자 표의 기존 일괄 액션으로.
- message_logs 전체를 list로 내려 규모가 커지면 추후 class 단위 필터링 또는 별도 액션으로 최적화 가능(현재 규모에선 불필요, YAGNI).
