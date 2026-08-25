-- DanjiOn PADIEM platform operator authorization.
-- This is intentionally separate from complex_memberships manager/admin roles.

create table if not exists padiem_operator_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  scope text not null,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  granted_by_user_id uuid references app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  check (char_length(scope) between 1 and 120),
  check (status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists uq_padiem_operator_active_scope
  on padiem_operator_grants (user_id, scope)
  where status = 'active';

create index if not exists idx_padiem_operator_scope_status
  on padiem_operator_grants (scope, status, expires_at);

create index if not exists idx_padiem_operator_user_status
  on padiem_operator_grants (user_id, status, expires_at);

comment on table padiem_operator_grants is
  'PADIEM platform authority only. Never infer these grants from apartment complex manager/admin membership.';
