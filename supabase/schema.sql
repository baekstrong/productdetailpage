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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);

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
  count(r.id) filter (where r.reservation_status = 'confirmed' or r.payment_status = 'paid') as confirmed_count,
  greatest(c.capacity - count(r.id) filter (where r.reservation_status = 'confirmed' or r.payment_status = 'paid'), 0) as available_count,
  count(r.id) filter (where r.reservation_status in ('applied', 'waitlisted')) as waitlist_count,
  count(r.id) filter (where r.reservation_status = 'payment_target') as payment_ready_count
from public.classes c
left join public.reservations r on r.class_id = c.id
where c.is_public = true and c.status <> 'hidden'
group by c.id;

alter table public.classes enable row level security;
alter table public.reservations enable row level security;
alter table public.message_logs enable row level security;

-- Public homepage can read only public class summaries.
create policy "public can read open classes"
on public.classes for select
to anon
using (is_public = true and status <> 'hidden');

-- 예약 신청은 submit-reservation Edge Function(service_role) 경유만 허용한다.
-- (과거의 anon 직접 insert 정책은 제거됨 — 검증·중복차단·접수 문자를 서버에서 일원화)

-- 같은 수업에 같은 번호의 활성 신청(취소/불참 제외)은 1건만 — 중복 신청 DB 차원 차단.
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

-- Seed example classes. Safe to run repeatedly if dates are unique enough for this simple project.
-- 예시 시드(날짜는 과거일 수 있음, 운영 DB에는 적용하지 말 것)
insert into public.classes (class_date, start_time, end_time, place, capacity, is_public, status)
values
  ('2026-06-06', '10:00', '13:00', '근력학교 고대점', 6, true, 'open'),
  ('2026-06-20', '10:00', '13:00', '근력학교 고대점', 6, true, 'waitlist'),
  ('2026-07-04', '10:00', '13:00', '근력학교 고대점', 6, true, 'open')
on conflict do nothing;
