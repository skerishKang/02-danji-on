-- #735 Household-code Resident Verification V1.
-- Source-only until an explicit Production migration gate is authorized.
-- Plaintext resident codes are never persisted.

create table if not exists household_verification_codes (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  household_id uuid not null,
  code_verifier text not null unique,
  status text not null default 'active' check (status in ('active','revoked')),
  generation integer not null default 1 check (generation >= 1),
  use_count integer not null default 0 check (use_count >= 0),
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  unique (id, household_id, complex_id),
  foreign key (household_id, complex_id)
    references households(id, complex_id) on delete cascade,
  check (char_length(code_verifier) = 64),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_household_verification_code_active_household
  on household_verification_codes (household_id)
  where status = 'active';

create index if not exists idx_household_verification_code_complex_status
  on household_verification_codes (complex_id, status);

create table if not exists household_verification_code_events (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid references complexes(id) on delete cascade,
  household_id uuid references households(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  action text not null check (action in ('verify_success','verify_failed','rotate','revoke')),
  request_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_household_verification_code_events_actor
  on household_verification_code_events (actor_user_id, created_at desc);
