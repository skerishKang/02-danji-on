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
