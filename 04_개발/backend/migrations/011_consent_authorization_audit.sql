-- DanjiOn consent and authorization audit foundation.
-- Keep audit records minimal and purpose-bound; do not store resident content/PII snapshots here.

create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  complex_id uuid references complexes(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms','privacy','resident_rules','community_rules','marketing')),
  policy_version text not null,
  status text not null check (status in ('accepted','withdrawn')),
  source text not null default 'web' check (source in ('web','admin','import')),
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  check (char_length(policy_version) between 1 and 80),
  check (status <> 'withdrawn' or withdrawn_at is not null)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user','operator','system')),
  complex_id uuid references complexes(id) on delete set null,
  action text not null,
  scope text,
  resource_type text,
  resource_id text,
  decision text check (decision in ('allowed','denied','recorded')),
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (request_id is null or char_length(request_id) between 1 and 160),
  check (char_length(action) between 1 and 120),
  check (scope is null or char_length(scope) between 1 and 120),
  check (resource_type is null or char_length(resource_type) between 1 and 80),
  check (resource_id is null or char_length(resource_id) between 1 and 160)
);

create index if not exists idx_consent_records_user_type_time
  on consent_records (user_id, consent_type, recorded_at desc);

create index if not exists idx_consent_records_complex_type_time
  on consent_records (complex_id, consent_type, recorded_at desc)
  where complex_id is not null;

create index if not exists idx_audit_events_actor_time
  on audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;

create index if not exists idx_audit_events_complex_action_time
  on audit_events (complex_id, action, created_at desc)
  where complex_id is not null;

create index if not exists idx_audit_events_scope_time
  on audit_events (scope, created_at desc)
  where scope is not null;
