-- DanjiOn Household / Resident Authorization v2 foundation.
-- Forward-only after production migrations 001-008.
-- Legacy complex_memberships remains intact during compatibility migration.

create table if not exists complex_units (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  building_code text not null,
  unit_code text not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complex_id, building_code, unit_code),
  unique (id, complex_id),
  check (char_length(building_code) between 1 and 20),
  check (char_length(unit_code) between 1 and 20)
);

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  complex_unit_id uuid not null,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complex_unit_id),
  unique (id, complex_id),
  foreign key (complex_unit_id, complex_id)
    references complex_units(id, complex_id) on delete restrict
);

create table if not exists household_memberships (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  household_id uuid not null,
  user_id uuid not null references app_users(id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('primary','member')),
  status text not null default 'pending' check (status in ('pending','verified','revoked')),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complex_id, user_id),
  unique (household_id, user_id),
  unique (id, household_id, complex_id),
  foreign key (household_id, complex_id)
    references households(id, complex_id) on delete cascade,
  check (status <> 'verified' or verified_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_household_primary_active
  on household_memberships (household_id)
  where membership_role = 'primary' and status in ('pending','verified');

create index if not exists idx_complex_units_complex_status
  on complex_units (complex_id, status, building_code, unit_code);

create index if not exists idx_households_complex_status
  on households (complex_id, status);

create index if not exists idx_household_memberships_user_status
  on household_memberships (user_id, status);

create index if not exists idx_household_memberships_complex_status
  on household_memberships (complex_id, status, created_at desc);

drop trigger if exists trg_complex_units_updated_at on complex_units;
create trigger trg_complex_units_updated_at
  before update on complex_units
  for each row execute function set_updated_at();

drop trigger if exists trg_households_updated_at on households;
create trigger trg_households_updated_at
  before update on households
  for each row execute function set_updated_at();

drop trigger if exists trg_household_memberships_updated_at on household_memberships;
create trigger trg_household_memberships_updated_at
  before update on household_memberships
  for each row execute function set_updated_at();
