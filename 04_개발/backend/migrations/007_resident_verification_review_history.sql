-- Immutable audit events for resident verification status changes.

create table if not exists resident_verification_review_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references resident_verifications(id) on delete cascade,
  membership_id uuid not null references complex_memberships(id) on delete cascade,
  complex_id uuid not null references complexes(id) on delete cascade,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('applicant','manager','system')),
  from_status text,
  to_status text not null check (to_status in ('pending','verified','rejected')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_resident_verification_review_events_verification
  on resident_verification_review_events (verification_id, created_at desc);

create index if not exists idx_resident_verification_review_events_complex
  on resident_verification_review_events (complex_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_resident_verification_review_event_from_status') then
    alter table resident_verification_review_events
      add constraint chk_resident_verification_review_event_from_status
      check (from_status is null or from_status in ('unverified','pending','verified','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_resident_verification_review_event_note_length') then
    alter table resident_verification_review_events
      add constraint chk_resident_verification_review_event_note_length
      check (note is null or char_length(note) <= 1000);
  end if;
end $$;

create or replace function record_resident_verification_review_event()
returns trigger
language plpgsql
as $$
declare
  membership_complex_id uuid;
  membership_user_id uuid;
begin
  if old.status is distinct from new.status
     or old.note is distinct from new.note
     or old.reviewed_by is distinct from new.reviewed_by then
    select complex_id, user_id
      into membership_complex_id, membership_user_id
      from complex_memberships
      where id = new.membership_id;

    insert into resident_verification_review_events (
      verification_id,
      membership_id,
      complex_id,
      actor_user_id,
      actor_type,
      from_status,
      to_status,
      note
    ) values (
      new.id,
      new.membership_id,
      membership_complex_id,
      coalesce(new.reviewed_by, membership_user_id),
      case
        when new.reviewed_by is not null then 'manager'
        when membership_user_id is not null then 'applicant'
        else 'system'
      end,
      old.status,
      new.status,
      new.note
    );
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_resident_verification_review_history'
  ) then
    create trigger trg_resident_verification_review_history
      after update of status, note, reviewed_by
      on resident_verifications
      for each row
      execute function record_resident_verification_review_event();
  end if;
end $$;
