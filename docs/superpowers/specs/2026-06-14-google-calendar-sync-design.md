# 수업 일정 → 구글 캘린더 자동 동기화 — 설계 문서

**작성일:** 2026-06-14
**상태:** 설계 승인 대기

## 목표

관리자 화면에서 수업을 **등록/수정/삭제**하면, 같은 작업이 **구글 캘린더에도 자동 반영**되게 한다. 근력학교 앱(시간표 관리 기능)이 이미 쓰는 **같은 서비스 계정·같은 캘린더**를 재사용하되, 케틀벨 앱은 자체적으로(독립적으로) 캘린더 API를 호출한다.

## 핵심 결정 (확정)

- **연동 방식:** Google Calendar API 즉시 연동(서비스 계정).
- **동기화 범위:** 등록·수정·삭제 모두.
- **캘린더:** 근력학교 앱과 **같은 캘린더**(`GOOGLE_CALENDAR_ID` 동일 값) — 입학반 일정과 케틀벨 수업이 한 캘린더에 함께 표시됨.
- **구현 위치:** 케틀벨 `admin-reservations` Edge Function(Deno)에서 직접 호출. 근력학교 Netlify 함수에 의존하지 않음(독립 동작).

## 왜 직접 구현인가 (런타임 차이)

근력학교는 **Netlify(Node.js) + `googleapis` 라이브러리**를 쓰지만, 케틀벨은 **Supabase Edge(Deno)** 환경이라 `googleapis`를 그대로 쓰기 어렵다. 따라서 Deno 표준 `crypto.subtle`로 **서비스 계정 JWT(RS256)를 직접 서명** → OAuth 액세스 토큰 발급 → Calendar REST API 호출 방식으로 구현한다. 외부 라이브러리·번들러 추가 없음(프로젝트 컨벤션 유지).

## 아키텍처

```
admin.html (관리자)
   └─ callAdminApi('createClass'|'updateClass'|'deleteClass')
        └─ admin-reservations (Edge Function, Deno)
             ├─ classes 테이블 insert/update/delete (기존)
             └─ calendar.ts 모듈 (신규)
                  ├─ getAccessToken(): 서비스계정 JWT(RS256) → OAuth 토큰 (캐시)
                  ├─ createEvent() → Google Calendar REST → eventId 반환
                  ├─ updateEvent(eventId)
                  └─ deleteEvent(eventId)
```

- 캘린더 로직은 `supabase/functions/admin-reservations/calendar.ts` **모듈로 분리**하고 `index.ts`에서 import(파일 비대화 방지, 한 가지 책임).
- 캘린더 호출은 **베스트 에포트**: 실패해도 수업 등록/수정/삭제 자체는 성공으로 응답(문자 발송과 동일 원칙). 실패는 콘솔 로그.

## 인증 (서비스 계정 JWT → OAuth)

1. JWT 헤더 `{alg:"RS256", typ:"JWT"}` + 클레임 `{iss: client_email, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat, exp(+1h)}`.
2. `crypto.subtle.importKey('pkcs8', <private key DER>, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign'])` 로 키 임포트, base64url(header).base64url(claim) 을 서명.
3. `POST https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`) → `access_token`.
4. 액세스 토큰은 함수 인스턴스 메모리에 만료 전까지 캐시(매 호출 재발급 방지).

**private key 형식 처리:** 서비스 계정 JSON의 `private_key`는 PEM(`-----BEGIN PRIVATE KEY-----\n...\n-----END...`). 환경변수 저장 시 줄바꿈이 `\n` 문자열로 들어오므로, 코드에서 `\\n` → 실제 개행 복원 후 PEM 본문(base64)만 추출해 DER로 디코드한다(근력학교 calendar.js의 복원 로직과 동일한 문제 대응).

## 시크릿 (Supabase) — 근력학교 값 재사용

`supabase secrets set` 으로 등록(코드/저장소에 하드코딩 금지):
- `GOOGLE_CLIENT_EMAIL` — 서비스 계정 이메일
- `GOOGLE_PRIVATE_KEY` — 서비스 계정 private key
- `GOOGLE_CALENDAR_ID` — 대상 캘린더 ID (근력학교와 동일 값)

> 값은 근력학교 앱의 `.env`(또는 서비스 계정 JSON 파일)에서 그대로 복사. 백관장이 한 번 설정. `GOOGLE_CALENDAR_ID`가 비어 있으면 캘린더 연동을 조용히 skip(미설정 환경 안전).

## 데이터 변경

`classes` 테이블에 컬럼 1개 추가:
```sql
alter table public.classes add column if not exists google_event_id text;
```
- 수업 ↔ 캘린더 이벤트 연결용. 수정/삭제 시 어느 이벤트를 고칠지 식별.
- 라이브 DB에는 SQL Editor에서 위 한 줄 실행(스키마 파일에도 반영).

## 이벤트 내용

- **제목:** `[케틀벨 원데이] 6월 27일 (토)` — 근력학교의 `[입학반] …` 패턴과 일관, 같은 캘린더에서 구분 쉬움.
- **시간:** `class_date` + `start_time`~`end_time`, `timeZone: 'Asia/Seoul'`.
- **장소(location):** 수업 `place`(예: 근력학교 고대점).
- **설명(description):** 예약/안내 페이지 링크(`https://baekstrong.github.io/productdetailpage/`).
- 신청 현황(예약/대기 인원)은 실시간 변하므로 이벤트에 넣지 않음.

## 동작 상세

| 관리자 작업 | classes 테이블 | 캘린더 |
|---|---|---|
| createClass | insert | createEvent → 반환된 eventId를 해당 row의 `google_event_id`에 update |
| updateClass | update(필드) | `google_event_id` 있으면 updateEvent로 제목/시간/장소 갱신, 없으면 createEvent 후 id 저장 |
| deleteClass | (삭제 전) `google_event_id` 조회 → deleteEvent → 그 후 row delete(기존 cascade 유지) |

- updateClass에서 날짜/시간/장소가 안 바뀌어도 이벤트를 다시 계산해 갱신(단순화 — 항상 최신 반영).
- 캘린더 이벤트가 사람이 캘린더에서 수동 삭제됐으면 update/delete가 404 → 그 오류는 무시(베스트 에포트).

## 에러 처리

- 모든 캘린더 호출은 try/catch. 실패 시 수업 작업 응답에 영향 없음(success 유지), `console.error`로 사유 기록.
- 토큰 발급 실패/시크릿 미설정 → skip(수업 작업은 정상).

## 테스트

- 계약 테스트(`tests/test_static_pages.py`): `admin-reservations/index.ts`·`calendar.ts`에 `createEvent`/`updateEvent`/`deleteEvent`·`GOOGLE_CALENDAR_ID`·`oauth2.googleapis.com/token` 존재 확인. `schema.sql`에 `google_event_id` 존재 확인.
- 수동 검증: 수업 등록 → 캘린더에 이벤트 생성 / 수정 → 시간 변경 반영 / 삭제 → 이벤트 사라짐.

## 배포 / 설정 체크리스트

1. `classes`에 `google_event_id` 컬럼 추가(SQL Editor + schema.sql).
2. Supabase 시크릿 3개 등록(`GOOGLE_CLIENT_EMAIL`/`GOOGLE_PRIVATE_KEY`/`GOOGLE_CALENDAR_ID`, 근력학교 값 재사용).
3. 서비스 계정이 대상 캘린더에 **이미 "일정 변경" 권한**으로 공유돼 있는지 확인(근력학교에서 이미 돼 있으면 그대로).
4. `admin-reservations` 재배포(`--no-verify-jwt`).
5. 수동 검증.

## 알려진 한계 / YAGNI

- 신청 현황은 이벤트에 안 넣음(실시간성·갱신 부담).
- 이벤트 색상·알림 등 세부 옵션은 기본값(추후 필요 시).
- 토큰 캐시는 함수 인스턴스 단위(콜드스타트마다 재발급) — 호출 빈도가 낮아 충분.
