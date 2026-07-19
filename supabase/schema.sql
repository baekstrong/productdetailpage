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
