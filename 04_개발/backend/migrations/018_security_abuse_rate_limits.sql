-- DanjiOn authentication and product-mutation abuse limits.
--
-- Better Auth owns the danjion_auth rate-limit model. Product mutation limits
-- are a separate DanjiOn authorization-adjacent control keyed only by the
-- internal app_users.id actor identifier. No resident PII belongs in either
-- product rate-limit keys or product bucket rows.

create table if not exists danjion_auth.rate_limit (
  id text primary key,
  key text not null,
  count integer not null,
  last_request bigint not null,
  constraint chk_danjion_auth_rate_limit_count check (count >= 0)
);

create unique index if not exists danjion_auth_rate_limit_key_uidx
  on danjion_auth.rate_limit (key);

comment on table danjion_auth.rate_limit is
  'Persistent Better Auth rate-limit state for serverless runtime instances.';

create table if not exists product_mutation_rate_limits (
  actor_user_id uuid not null references app_users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (actor_user_id, action, window_start),
  constraint chk_product_mutation_rate_limit_action
    check (char_length(action) between 1 and 80),
  constraint chk_product_mutation_rate_limit_count
    check (request_count >= 1)
);

create index if not exists idx_product_mutation_rate_limits_updated
  on product_mutation_rate_limits (updated_at);

comment on table product_mutation_rate_limits is
  'Atomic fixed-window counters for bounded high-abuse DanjiOn product mutations. Keys use internal app_users.id only.';
