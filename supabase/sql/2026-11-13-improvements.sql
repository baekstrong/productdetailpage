-- 2026-11-13 개선 묶음 (운영 DB에 이 파일만 실행 — 재실행해도 안전하도록 if not exists / or replace 사용)
-- ① 요청 횟수 제한(rate_events)  ② 정원 동시 신청 잠금(create_reservation_atomic)
-- ③ 다음 일정 오픈 알림 명단(class_open_alerts)  ④ 번호 해시(phone_hash, 파기 후에도 노쇼·재수강 이력 유지)
-- ⑤ 개인정보 파기 함수(purge_personal_data) — cron 등록은 운영자 확인 후 별도 실행

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

-- 요청 기록 청소(개인정보 아님, 매일 04:10 KST) — 파기 cron과 별개로 바로 등록.
select cron.unschedule('rate-events-cleanup') where exists (select 1 from cron.job where jobname = 'rate-events-cleanup');
select cron.schedule('rate-events-cleanup', '10 19 * * *', $$delete from public.rate_events where created_at < now() - interval '2 days'$$);

-- (운영자 확인 후 실행) 개인정보 자동 파기 — 매일 04:20 KST, 수업일 90일 경과분
-- select cron.schedule('purge-personal-data', '20 19 * * *', $$select public.purge_personal_data(90)$$);

-- 결제 기한(시간)은 공개 페이지 안내 문구에 쓰이므로 anon 읽기 허용(그 키만).
drop policy if exists "anon can read payment deadline" on public.app_settings;
create policy "anon can read payment deadline" on public.app_settings for select to anon using (key = 'payment_deadline_hours');
