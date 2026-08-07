-- DanjiOn business application review history.
-- Keeps immutable review transitions separate from the latest-state columns on business_applications.

create table if not exists business_application_review_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references business_applications(id) on delete cascade,
  complex_id uuid not null references complexes(id) on delete cascade,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('applicant','manager','system')),
  from_status text,
  to_status text not null,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_application_review_events_application
  on business_application_review_events(application_id, created_at asc);

create index if not exists idx_application_review_events_complex
  on business_application_review_events(complex_id, created_at desc);

create or replace function record_business_application_review_event()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status
     or old.review_note is distinct from new.review_note
     or old.approved_business_id is distinct from new.approved_business_id then
    insert into business_application_review_events (
      application_id,
      complex_id,
      actor_user_id,
      actor_type,
      from_status,
      to_status,
      review_note
    ) values (
      new.id,
      new.complex_id,
      coalesce(new.reviewed_by, new.applicant_user_id),
      case
        when new.reviewed_by is not null then 'manager'
        when new.applicant_user_id is not null then 'applicant'
        else 'system'
      end,
      old.status,
      new.status,
      new.review_note
    );
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_business_application_review_history'
  ) then
    create trigger trg_business_application_review_history
      after update of status, review_note, approved_business_id
      on business_applications
      for each row
      execute function record_business_application_review_event();
  end if;
end $$;
