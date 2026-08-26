-- DanjiOn self-hosted Better Auth foundation.
-- IMPORTANT: this schema is deliberately separate from Neon's managed neon_auth schema.
-- Account authentication remains separate from resident verification and PADIEM authorization.

create schema if not exists danjion_auth;

create table if not exists danjion_auth."user" (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  username text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists danjion_auth.session (
  id text primary key,
  user_id text not null references danjion_auth."user"(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists danjion_auth_session_user_id_idx
  on danjion_auth.session (user_id);

create table if not exists danjion_auth.account (
  id text primary key,
  user_id text not null references danjion_auth."user"(id) on delete cascade,
  issuer text not null,
  account_id text not null,
  provider_id text not null,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  id_token text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists danjion_auth_account_user_id_idx
  on danjion_auth.account (user_id);

create unique index if not exists danjion_auth_account_issuer_account_id_uidx
  on danjion_auth.account (issuer, account_id);

create table if not exists danjion_auth.verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists danjion_auth_verification_identifier_idx
  on danjion_auth.verification (identifier);

create table if not exists danjion_auth.jwks (
  id text primary key,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

comment on schema danjion_auth is
  'Danjion Better Auth account/session boundary. Never use this schema as resident verification authority.';
