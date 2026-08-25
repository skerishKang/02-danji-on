-- DanjiOn Household invite / family lifecycle.
-- Store only token hashes; plaintext invite tokens must never be persisted.

create table if not exists household_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  household_id uuid not null,
  token_hash text not null unique,
  purpose text not null default 'family' check (purpose in ('primary_claim','family')),
  status text not null default 'active' check (status in ('active','redeemed','revoked','expired')),
  max_uses smallint not null default 1 check (max_uses between 1 and 20),
  use_count smallint not null default 0 check (use_count >= 0),
  created_by_user_id uuid references app_users(id) on delete set null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (household_id, complex_id)
    references households(id, complex_id) on delete cascade,
  check (char_length(token_hash) between 32 and 128),
  check (use_count <= max_uses),
  check (status <> 'redeemed' or redeemed_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);

create table if not exists family_invites (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  household_id uuid not null,
  invite_token_id uuid not null references household_invite_tokens(id) on delete cascade,
  inviter_membership_id uuid not null,
  accepted_by_user_id uuid references app_users(id) on delete set null,
  accepted_membership_id uuid references household_memberships(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  foreign key (household_id, complex_id)
    references households(id, complex_id) on delete cascade,
  foreign key (inviter_membership_id, household_id, complex_id)
    references household_memberships(id, household_id, complex_id) on delete restrict,
  check (status <> 'accepted' or (accepted_at is not null and accepted_by_user_id is not null and accepted_membership_id is not null)),
  check (status <> 'revoked' or revoked_at is not null)
);

create index if not exists idx_household_invite_tokens_household_status
  on household_invite_tokens (household_id, status, expires_at);

create index if not exists idx_family_invites_household_status
  on family_invites (household_id, status, created_at desc);

create index if not exists idx_family_invites_accepted_user
  on family_invites (accepted_by_user_id, status)
  where accepted_by_user_id is not null;
