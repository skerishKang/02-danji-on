-- Keep the immutable 014_danjion_better_auth.sql migration intact.
-- Better Auth runtime uses database-backed rate limiting and its Drizzle schema
-- expects danjion_auth.rate_limit. Production has not yet applied the Danjion
-- Better Auth schema, so this additive migration closes the schema/runtime gap.

create schema if not exists danjion_auth;

create table if not exists danjion_auth.rate_limit (
  id text primary key,
  key text not null,
  count integer not null,
  last_request bigint not null
);

create unique index if not exists danjion_auth_rate_limit_key_uidx
  on danjion_auth.rate_limit (key);

comment on table danjion_auth.rate_limit is
  'Better Auth database-backed request rate-limit state; not resident verification authority.';
