-- #592 / #396: pre-registered administrator identity bootstrap.
-- This table is onboarding authority only. Persistent runtime authorization
-- remains exclusively in padiem_operator_grants after a successful bootstrap.
-- No row is inserted by this migration; Production principals require a
-- separate explicit operator-approved data mutation.

create table if not exists padiem_admin_identity_allowlist (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('google','credential')),
  normalized_email text not null,
  provider_account_id text,
  authority_level text not null check (authority_level in ('operator','admin')),
  scopes text[] not null,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,

  check (char_length(normalized_email) between 3 and 254),
  check (normalized_email = lower(btrim(normalized_email))),
  check (position('@' in normalized_email) > 1),
  check (provider_account_id is null or char_length(provider_account_id) between 1 and 255),
  check (cardinality(scopes) between 1 and 32),
  check (
    (authority_level = 'admin' and scopes = array['*']::text[])
    or
    (authority_level = 'operator' and array_position(scopes, '*') is null)
  ),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_padiem_admin_identity_allowlist_active
  on padiem_admin_identity_allowlist (provider, normalized_email)
  where status = 'active';

create index if not exists idx_padiem_admin_identity_allowlist_status
  on padiem_admin_identity_allowlist (status, expires_at);

comment on table padiem_admin_identity_allowlist is
  'Explicit pre-registration for administrator onboarding only. Never treat provider login or email alone as runtime authorization; successful bootstrap materializes authority into padiem_operator_grants.';
