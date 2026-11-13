-- Supabase free-plan schema for Kettlebell One-Day reservation admin
-- Run in Supabase SQL editor before deploying Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  class_date date not null,
  start_time time not null,
  end_time time not null,
  place text not null default '근력학교 고대점',
  capacity integer not null default 6 check (capacity > 0),
  is_public boolean not null default true,
  status text not null default 'open' check (status in ('open', 'waitlist', 'closed', 'hidden')),
  open_at timestamptz,
  preview_before_open boolean not null default false,
  payment_reminder_sent_at timestamptz,
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존 classes 테이블에 캘린더 이벤트 연결용 컬럼 추가(수업↔구글 캘린더 이벤트 매핑).
alter table public.classes add column if not exists google_event_id text;
-- 예약 오픈 일시 + 오픈 전 달력 미리보기(기존 테이블 보강).
alter table public.classes add column if not exists open_at timestamptz;
alter table public.classes add column if not exists preview_before_open boolean not null default false;
alter table public.classes add column if not exists payment_reminder_sent_at timestamptz;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  applicant_name text not null,
  phone text not null,
  phone_masked text generated always as (regexp_replace(phone, '^(010)([0-9]{4})([0-9]{4})$', '\1****\3')) stored,
  email text,
  kettlebell_experience text,
  reason text,
  reservation_status text not null default 'applied' check (reservation_status in ('applied', 'payment_target', 'confirmed', 'waitlisted', 'cancelled', 'no_show')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'sent', 'paid', 'expired', 'refunded')),
  waitlist_order integer,
  admin_memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete set null,
  message_type text not null,
  phone_masked text not null,
  provider_message_id text,
  status text not null default 'queued',
  error_message text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  body text, -- 실제 발송된 본문(관리자 현황판 '내용 보기'용). 도입(2026-07-19) 전 기록은 null.
  created_at timestamptz not null default now()
);

-- 기존 DB 반영용
alter table public.message_logs add column if not exists body text;

create or replace view public.class_reservation_summary as
select
  c.id as class_id,
  c.class_date,
  c.start_time,
  c.end_time,
  c.place,
  c.capacity,
  c.is_public,
  c.status,
  count(r.id) filter (where (r.reservation_status = 'confirmed' or r.payment_status = 'paid') and r.reservation_status not in ('cancelled', 'no_show')) as confirmed_count,
  -- 남은 자리 = 정원 - 자리 점유자(확정 + 결제 안내 중). 즉시 결제 체제에서 payment_target은 자리를 점유한다.
  greatest(c.capacity - count(r.id) filter (where r.reservation_status not in ('cancelled', 'no_show') and (r.reservation_status in ('confirmed', 'payment_target') or r.payment_status = 'paid')), 0) as available_count,
  count(r.id) filter (where r.reservation_status in ('applied', 'waitlisted')) as waitlist_count,
  count(r.id) filter (where r.reservation_status = 'payment_target') as payment_ready_count,
  c.open_at,
  c.preview_before_open,
  (c.open_at is null or c.open_at <= now()) as is_open
from public.classes c
left join public.reservations r on r.class_id = c.id
where c.is_public = true
  and c.status <> 'hidden'
  and (c.open_at is null or c.open_at <= now() or c.preview_before_open = true)
group by c.id;

alter table public.classes enable row level security;
alter table public.reservations enable row level security;
alter table public.message_logs enable row level security;

-- Public homepage can read only public + opened/preview class summaries.
drop policy if exists "public can read open classes" on public.classes;
create policy "public can read open classes"
on public.classes for select
to anon
using (
  is_public = true
  and status <> 'hidden'
  and (open_at is null or open_at <= now() or preview_before_open = true)
);

-- 예약 신청은 submit-reservation Edge Function(service_role) 경유만 허용한다.
-- (과거의 anon 직접 insert 정책은 제거됨 — 검증·중복차단·접수 문자를 서버에서 일원화)

-- 같은 수업에 같은 번호의 활성 신청(취소/불참 제외)은 1건만 — 같은 수업 중복 신청 DB 차원 차단.
-- (다른 날짜의 '대기' 중복은 허용, '선착순 자리' 중복만 submit-reservation이 앱 레벨에서 차단한다.)
create unique index if not exists reservations_active_unique
  on public.reservations (class_id, phone)
  where reservation_status not in ('cancelled', 'no_show');

-- Direct reservation reads are blocked for anon; admin access should go through Edge Functions with service role.
create policy "anon cannot read reservations"
on public.reservations for select
to anon
using (false);

create policy "anon cannot read message logs"
on public.message_logs for select
to anon
using (false);

-- 관리자가 수정한 문자 템플릿 저장소. 행이 있으면 solapi-reservations가 코드 기본 템플릿 대신 이 body를 쓴다.
-- (행 삭제 = 기본값 복원. 접근은 Edge Function(service_role) 경유만 — anon 정책 없음이라 RLS로 차단됨)
create table if not exists public.message_templates (
  message_type text primary key,
  body text not null,
  updated_at timestamptz not null default now()
);

alter table public.message_templates enable row level security;

-- 예약 거부(차단) 번호 명단. 등록된 번호는 submit-reservation이 신규 신청을 거부한다.
-- (관리자 벌크 액션 '예약 거부'로 등록, '차단됨' 배지 클릭으로 해제. Edge Function 경유만 — anon 정책 없음)
create table if not exists public.blocked_phones (
  phone text primary key,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.blocked_phones enable row level security;

-- 운영 설정 키-값 저장소 (예: payment_deadline_hours = 결제 안내 후 결제 기한(시간), 기본 24).
-- 문자 템플릿 {payment_deadline_hours} 치환과 관리자 '결제 안내 중 Nh 경과' 배지 기준에 쓰인다.
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Seed example classes. Safe to run repeatedly if dates are unique enough for this simple project.
-- 예시 시드(날짜는 과거일 수 있음, 운영 DB에는 적용하지 말 것)
insert into public.classes (class_date, start_time, end_time, place, capacity, is_public, status)
values
  ('2026-06-06', '10:00', '13:00', '근력학교 고대점', 6, true, 'open'),
  ('2026-06-20', '10:00', '13:00', '근력학교 고대점', 6, true, 'waitlist'),
  ('2026-07-04', '10:00', '13:00', '근력학교 고대점', 6, true, 'open')
on conflict do nothing;


-- ============================================================
-- 2026-11-13 개선 묶음 (운영 적용본: supabase/sql/2026-11-13-improvements.sql — cron 등록은 그 파일 참고)
-- ============================================================
-- ① 요청 횟수 제한 -------------------------------------------------------------
create table if not exists public.rate_events (
  id bigserial primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_bucket_time on public.rate_events (bucket, created_at);
alter table public.rate_events enable row level security;

-- 창(window) 안의 기록 수가 p_max 미만이면 true(+p_record면 1건 기록), 이상이면 false.
create or replace function public.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer, p_record boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_bucket));
  select count(*) into n from public.rate_events
   where bucket = p_bucket and created_at > now() - make_interval(secs => p_window_seconds);
  if n >= p_max then return false; end if;
  if p_record then insert into public.rate_events(bucket) values (p_bucket); end if;
  return true;
end $$;

-- 실패 기록만 남길 때(관리자 로그인 실패 등).
create or replace function public.rate_limit_record(p_bucket text)
returns void
language sql
security definer
set search_path = public
as $$ insert into public.rate_events(bucket) values (p_bucket); $$;

revoke all on function public.rate_limit_hit(text, integer, integer, boolean) from public, anon, authenticated;
revoke all on function public.rate_limit_record(text) from public, anon, authenticated;

-- ④ 번호 해시 ------------------------------------------------------------------
alter table public.reservations add column if not exists phone_hash text;

create or replace function public.reservations_set_phone_hash()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.phone ~ '^010[0-9]{8}$' then
    new.phone_hash := encode(extensions.digest(new.phone, 'sha256'), 'hex');
  elsif tg_op = 'UPDATE' then
    new.phone_hash := old.phone_hash; -- 파기(번호 치환) 후에도 이전 해시 유지
  end if;
  return new;
end $$;

drop trigger if exists reservations_phone_hash on public.reservations;
create trigger reservations_phone_hash
  before insert or update of phone on public.reservations
  for each row execute function public.reservations_set_phone_hash();

update public.reservations
   set phone_hash = encode(extensions.digest(phone, 'sha256'), 'hex')
 where phone_hash is null and phone ~ '^010[0-9]{8}$';

create index if not exists reservations_phone_hash_idx on public.reservations (phone_hash);

-- ② 정원 동시 신청 잠금 ---------------------------------------------------------
-- 수업 행을 FOR UPDATE로 잠근 뒤 인원 집계 → 선착순/대기 판정 → insert를 한 트랜잭션에서 처리한다.
-- 'closed'(마감) 수업은 정원이 남아도 대기로만 받는다(공개 달력의 '만석·대기 가능' 표시와 일치).
create or replace function public.create_reservation_atomic(
  p_class_id uuid,
  p_name text,
  p_phone text,
  p_experience text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.classes%rowtype;
  active_count integer;
  will_wait boolean;
  blocker_class uuid;
  new_id uuid;
begin
  select * into c from public.classes where id = p_class_id for update;
  if not found then return jsonb_build_object('error', 'class_not_found'); end if;

  select count(*) into active_count from public.reservations
   where class_id = p_class_id and reservation_status not in ('cancelled', 'no_show');

  will_wait := (c.capacity > 0 and active_count >= c.capacity) or c.status = 'closed';

  if not will_wait then
    select class_id into blocker_class from public.reservations
     where phone = p_phone and reservation_status in ('applied', 'payment_target', 'confirmed')
     limit 1;
    if found then
      return jsonb_build_object('error', case when blocker_class = p_class_id then 'same_class' else 'seat_dup' end);
    end if;
  end if;

  insert into public.reservations (class_id, applicant_name, phone, kettlebell_experience, reason, reservation_status, payment_status)
  values (p_class_id, p_name, p_phone, nullif(p_experience, ''), nullif(p_reason, ''),
          case when will_wait then 'waitlisted' else 'payment_target' end,
          case when will_wait then 'pending' else 'sent' end)
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'waitlisted', will_wait, 'active_count', active_count, 'capacity', c.capacity);
exception when unique_violation then
  return jsonb_build_object('error', 'same_class');
end $$;

revoke all on function public.create_reservation_atomic(uuid, text, text, text, text) from public, anon, authenticated;

-- ③ 다음 일정 오픈 알림 명단 ----------------------------------------------------
create table if not exists public.class_open_alerts (
  id uuid primary key default gen_random_uuid(),
  applicant_name text,
  phone text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
-- 번호당 '아직 알림 안 받은' 신청은 1건만.
create unique index if not exists class_open_alerts_pending_unique
  on public.class_open_alerts (phone) where notified_at is null;
alter table public.class_open_alerts enable row level security;

-- ⑤ 개인정보 파기 ---------------------------------------------------------------
-- 수업일로부터 p_days일 지난 신청의 이름·번호·메모를 지운다(번호는 행별 고유 자리표시자로 치환).
-- phone_hash는 남겨 노쇼·재수강 이력 배지에만 쓴다(원래 번호 복원 불가).
create or replace function public.purge_personal_data(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff date := (now() at time zone 'Asia/Seoul')::date - p_days;
  n_res integer;
  n_logs integer;
  n_alerts integer;
begin
  with target as (
    select r.id from public.reservations r
      join public.classes c on c.id = r.class_id
     where c.class_date < cutoff and r.applicant_name <> '(파기됨)'
  )
  update public.reservations r
     set applicant_name = '(파기됨)',
         phone = 'purged-' || replace(r.id::text, '-', ''),
         email = null,
         kettlebell_experience = null,
         reason = null,
         admin_memo = null,
         updated_at = now()
   where r.id in (select id from target);
  get diagnostics n_res = row_count;

  update public.message_logs l
     set body = null
   where l.body is not null
     and l.created_at < now() - make_interval(days => p_days)
     and (l.scheduled_at is null or l.scheduled_at < now());
  get diagnostics n_logs = row_count;

  delete from public.class_open_alerts
   where (notified_at is not null and notified_at < now() - make_interval(days => p_days))
      or created_at < now() - interval '1 year';
  get diagnostics n_alerts = row_count;

  delete from public.rate_events where created_at < now() - interval '2 days';

  return jsonb_build_object('reservations', n_res, 'message_bodies', n_logs, 'alerts', n_alerts, 'cutoff', cutoff);
end $$;

revoke all on function public.purge_personal_data(integer) from public, anon, authenticated;


-- 결제 기한(시간)은 공개 페이지 안내 문구에 쓰이므로 anon 읽기 허용(그 키만).
drop policy if exists "anon can read payment deadline" on public.app_settings;
create policy "anon can read payment deadline" on public.app_settings for select to anon using (key = 'payment_deadline_hours');
