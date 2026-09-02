-- DanjiOn resident safety reports v1.
-- Community post/comment reports remain canonical in community_reports.
-- This table covers only resident profile, message and business-review targets.
-- Target content is never copied into the report row; target IDs are validated at insertion time.

create table if not exists resident_safety_reports (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  reporter_user_id uuid not null references app_users(id) on delete restrict,
  resident_user_id uuid,
  message_id uuid,
  review_id uuid,
  reason text not null check (reason in ('abuse','threat','privacy','defamation_risk','spam','other')),
  detail text,
  status text not null default 'submitted' check (status in ('submitted','reviewing','resolved','dismissed')),
  resolved_by_user_id uuid references app_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (resident_user_id is not null)::integer
    + (message_id is not null)::integer
    + (review_id is not null)::integer = 1
  ),
  check (detail is null or char_length(detail) <= 1000),
  check (
    status in ('submitted','reviewing')
    or (resolved_at is not null and resolved_by_user_id is not null)
  )
);

create index if not exists idx_resident_safety_reports_queue
  on resident_safety_reports (complex_id, status, created_at asc)
  where status in ('submitted','reviewing');

create unique index if not exists uq_resident_safety_open_resident_report
  on resident_safety_reports (reporter_user_id, resident_user_id)
  where resident_user_id is not null and status in ('submitted','reviewing');

create unique index if not exists uq_resident_safety_open_message_report
  on resident_safety_reports (reporter_user_id, message_id)
  where message_id is not null and status in ('submitted','reviewing');

create unique index if not exists uq_resident_safety_open_review_report
  on resident_safety_reports (reporter_user_id, review_id)
  where review_id is not null and status in ('submitted','reviewing');

create or replace function enforce_resident_safety_report_target()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from household_memberships hm
    join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
    join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
    where hm.user_id = new.reporter_user_id
      and hm.complex_id = new.complex_id
      and hm.status = 'verified'
      and h.status = 'active'
      and cu.status = 'active'
  ) then
    raise exception 'safety report reporter is not a verified resident in target complex';
  end if;

  if new.resident_user_id is not null then
    if new.resident_user_id = new.reporter_user_id then
      raise exception 'resident cannot report self';
    end if;
    if not exists (
      select 1
      from app_users u
      join household_memberships hm on hm.user_id = u.id
      join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
      join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
      where u.id = new.resident_user_id
        and u.account_status = 'active'
        and hm.complex_id = new.complex_id
        and hm.status = 'verified'
        and h.status = 'active'
        and cu.status = 'active'
    ) then
      raise exception 'resident report target is not active in target complex';
    end if;
  elsif new.message_id is not null then
    if not exists (
      select 1
      from messages m
      join conversations c on c.id = m.conversation_id
      join conversation_members cm
        on cm.conversation_id = c.id
       and cm.user_id = new.reporter_user_id
      where m.id = new.message_id
        and c.complex_id = new.complex_id
        and m.sender_user_id <> new.reporter_user_id
        and m.deleted_at is null
    ) then
      raise exception 'message report target is unavailable to reporter';
    end if;
  elsif new.review_id is not null then
    if not exists (
      select 1
      from business_reviews r
      where r.id = new.review_id
        and r.complex_id = new.complex_id
        and r.status = 'active'
        and r.author_user_id <> new.reporter_user_id
    ) then
      raise exception 'review report target is unavailable to reporter';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_resident_safety_report_target on resident_safety_reports;
create trigger trg_resident_safety_report_target
  before insert or update of complex_id, reporter_user_id, resident_user_id, message_id, review_id
  on resident_safety_reports
  for each row execute function enforce_resident_safety_report_target();

drop trigger if exists trg_resident_safety_reports_updated_at on resident_safety_reports;
create trigger trg_resident_safety_reports_updated_at
  before update on resident_safety_reports
  for each row execute function set_updated_at();
