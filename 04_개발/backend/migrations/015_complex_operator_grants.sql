-- DanjiOn complex-scoped operator authorization.
-- Product-owner governance: day-to-day operations are PADIEM + resident council.
-- Management office is not a default DanjiOn operator; any support authority must be explicit and onboarding-only.

create table if not exists complex_operator_grants (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  operator_kind text not null check (operator_kind in ('resident_council','onboarding_support')),
  scope text not null,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  granted_by_user_id uuid references app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  check (char_length(scope) between 1 and 120),
  check (status <> 'revoked' or revoked_at is not null),
  check (
    (operator_kind = 'resident_council' and scope like 'council.%')
    or
    (operator_kind = 'onboarding_support' and scope like 'onboarding.%')
  )
);

create unique index if not exists uq_complex_operator_active_scope
  on complex_operator_grants (complex_id, user_id, operator_kind, scope)
  where status = 'active';

create index if not exists idx_complex_operator_complex_scope_status
  on complex_operator_grants (complex_id, operator_kind, scope, status, expires_at);

create index if not exists idx_complex_operator_user_status
  on complex_operator_grants (user_id, status, expires_at);

comment on table complex_operator_grants is
  'Explicit complex-scoped DanjiOn operator grants. Never infer resident-council or onboarding authority from legacy complex_memberships manager/admin roles; onboarding_support never satisfies council.* scopes.';
