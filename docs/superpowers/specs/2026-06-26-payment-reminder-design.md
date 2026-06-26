# 운영자 결제 안내 리마인더 (D-7) 설계

**작성일:** 2026-06-26
**목표:** 수업 7일 전(KST 오전 9시), 그 수업에 미결제 신청자가 있으면 운영자(백관장)에게 "결제 안내를 보낼 시점"이라는 리마인더 문자를 1통 보낸다. 운영자가 D-7 결제 안내 타이밍을 놓치지 않게 한다.

**범위:** `supabase/schema.sql`(컬럼 추가 + cron 안내), `supabase/functions/solapi-reservations`(템플릿 1개), 신규 `supabase/functions/payment-reminder`, `supabase/functions/admin-reservations`(날짜 변경 시 이력 초기화), `supabase/config.toml`, 계약 테스트. 고객 화면(`index.html`)·결제·구글캘린더 무변경.

---

## 1. 데이터

`classes`에 컬럼 1개 추가(운영 DB는 `add column if not exists`):
```sql
alter table public.classes add column if not exists payment_reminder_sent_at timestamptz;
```
- 같은 수업에 리마인더가 **두 번 가지 않도록** 발송 이력·멱등 보장. NULL이면 아직 안 보냄.

## 2. 새 Edge Function `payment-reminder`

`config.toml`에 `[functions.payment-reminder] verify_jwt = false` 추가. 신규 `index.ts`.

- **인증**: 내부 호출만 허용 — `Authorization: Bearer <service_role>`을 `timingSafeEqual`로 검증(기존 `solapi-reservations`와 동일 패턴). 불일치면 401.
- **로직**(매 실행):
  1. KST 기준 **오늘 + 7일** 날짜(`YYYY-MM-DD`) 계산. 서버는 UTC이므로 `now + 9h`의 날짜 부분을 쓴다.
  2. `classes`에서 `class_date = <타깃>` AND `is_public = true` AND `status <> 'hidden'` AND `payment_reminder_sent_at is null` 조회.
  3. 각 수업의 **미결제 활성 신청자 수** 집계: `reservations` where `class_id` 일치 AND `reservation_status in ('applied','waitlisted','payment_target')`. (취소·노쇼·결제완료(`confirmed`/`paid`)는 제외 — 이미 결제했거나 빠진 사람은 대상 아님.)
  4. 신청자 수 ≥ 1 → 백관장에게 문자 발송 후 `payment_reminder_sent_at = now()` PATCH. **0명이면 발송하지 않고 이력도 남기지 않는다**(건너뜀).
  5. 처리 결과 요약 JSON 반환(`{ ok, target_date, classes_checked, reminders_sent }`). 발송 실패는 베스트 에포트(로그만, 전체 200).
- **문자 발송**: `solapi-reservations`를 내부 호출(`Bearer service_role`)하며 `messageType: 'admin_payment_reminder'`, `phone: <ADMIN_PHONE>`, `values: { class_label, count }`. Solapi 시크릿 미설정 시 안전 skip(기존 동작).

## 3. `solapi-reservations` 새 템플릿

`templates`에 `admin_payment_reminder` 추가, `MessageType` 유니온에도 추가:
```
admin_payment_reminder:
[케틀벨 원데이 리마인더]
{class_label} 수업이 7일 앞입니다.
현재 신청 {count}명 — 선착순 승인하고 결제 안내를 보내주세요.
```
- `class_label`은 `payment-reminder`가 만들어 넘긴다(예: `6월 30일(화)`). `count`는 미결제 활성 신청자 수.
- 운영자 대상 문자라 `[근력학교]` 접두어 없음(기존 정책). 마케팅 문구 없음.

## 4. 스케줄 (Supabase pg_cron + pg_net)

운영 DB SQL Editor에서 한 번 등록(스펙엔 절차만, 실제 값은 배포 단계):
```sql
-- 확장 활성화(최초 1회)
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- 매일 UTC 0시 = KST 09시
select cron.schedule('payment-reminder-daily', '0 0 * * *', $$
  select net.http_post(
    url := 'https://vjoxzbxcylqyhxezxiuj.supabase.co/functions/v1/payment-reminder',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```
- cron은 매일 도는 단일 항목. 함수가 "오늘+7일·미발송·신청자≥1"만 처리하므로 중복·과발송 없음.

## 5. 수업 날짜 변경 시 재예약

`admin-reservations`의 `updateClass`에서 **`class_date`가 변경되면 `payment_reminder_sent_at`을 NULL로 초기화**한다. 날짜를 옮기면 새 날짜 기준 D-7에 다시 리마인더가 가도록. (날짜 외 필드만 수정하면 초기화하지 않음.)

## 6. 시크릿

- **`ADMIN_PHONE`** — 백관장(리마인더 수신) 번호. `supabase secrets set ADMIN_PHONE=01000000000`. 미설정 시 `payment-reminder`는 발송 skip(안전).
- 기존 `SUPABASE_SERVICE_ROLE_KEY`·`SOLAPI_API_KEY`/`SOLAPI_API_SECRET` 재사용.

## 7. 테스트 (`tests/test_static_pages.py`)

계약(문자열 존재) 테스트:
- `schema.sql`에 `payment_reminder_sent_at` 컬럼.
- `payment-reminder/index.ts`에 service_role 인증, 오늘+7일 계산, 미결제 신청자 집계, `admin_payment_reminder` 호출.
- `solapi-reservations`에 `admin_payment_reminder` 템플릿 + "7일 앞" 문구.
- `admin-reservations`에 `payment_reminder_sent_at` 초기화 로직.
- `config.toml`에 `[functions.payment-reminder]`.
- 시크릿 미노출(기존 금지 항목) 유지.

## 8. 주의 / 엣지

- **D-7 당일 신청 0명**: 발송·이력 없음. 그 뒤 신청이 들어와도 D-7은 지나가 자동 리마인더는 안 옴(운영자가 관리자 캘린더로 확인). 의도된 단순화.
- **타임존**: `class_date`는 date, 서버는 UTC. 타깃 날짜는 `now + 9h`의 날짜로 KST 기준 계산.
- **멱등**: 같은 수업은 `payment_reminder_sent_at`로 1회만. cron이 하루 여러 번 돌아도 안전.
- **베스트 에포트**: Solapi/시크릿 문제로 발송 실패해도 함수는 200(다른 수업 처리 계속). 단 발송 성공해야 `sent_at` 기록.
- service_role을 cron SQL에 넣어야 함(DB 내부 저장). 노출 주의 — SQL은 운영자만 접근.
