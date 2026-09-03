-- Product-owned signup contact verification persistence.
-- Canonical OTP challenge semantics live in Padiem Control Plane; DanjiOn stores
-- trusted PII, opaque refs, persisted challenge state, rate budgets and receipts.
-- This schema is NOT resident/household verification authority.

create table if not exists signup_contact_sessions (
  signup_session_ref text primary key,
  email_normalized text not null,
  phone_normalized text not null,
  email_contact_ref text not null,
  phone_contact_ref text not null,
  network_ref text not null,
  phone_verified_at timestamptz,
  phone_verification_method text check (
    phone_verification_method is null
    or phone_verification_method in ('kakao_otp', 'kakao_login', 'sms_fallback')
  ),
  identity_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signup_contact_sessions_email_ref_idx
  on signup_contact_sessions (email_contact_ref);
create index if not exists signup_contact_sessions_phone_ref_idx
  on signup_contact_sessions (phone_contact_ref);

create table if not exists signup_contact_challenges (
  challenge_id text primary key,
  signup_session_ref text not null references signup_contact_sessions(signup_session_ref) on delete cascade,
  email_contact_ref text not null,
  phone_contact_ref text not null,
  network_ref text not null,
  channel text not null check (channel in ('kakao_simulated', 'kakao_alimtalk', 'sms_fallback')),
  otp_digest text not null check (otp_digest ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  resend_not_before timestamptz not null,
  attempts_used integer not null default 0 check (attempts_used >= 0),
  max_attempts integer not null check (max_attempts between 1 and 10),
  generation integer not null check (generation >= 1),
  state text not null check (state in ('pending', 'verified', 'expired', 'locked', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (signup_session_ref, generation),
  check (expires_at > issued_at),
  check (resend_not_before >= issued_at and resend_not_before <= expires_at),
  check (attempts_used <= max_attempts)
);

create index if not exists signup_contact_challenges_session_idx
  on signup_contact_challenges (signup_session_ref, generation desc);
create index if not exists signup_contact_challenges_phone_ref_idx
  on signup_contact_challenges (phone_contact_ref, issued_at desc);

create table if not exists signup_contact_rate_budgets (
  scope_type text not null check (scope_type in ('signup_session', 'phone_contact', 'network')),
  scope_ref text not null,
  window_started_at timestamptz not null,
  issues integer not null default 0 check (issues >= 0),
  last_issued_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_ref)
);

create table if not exists signup_contact_receipts (
  receipt_id text primary key,
  challenge_id text not null unique references signup_contact_challenges(challenge_id) on delete restrict,
  signup_session_ref text not null references signup_contact_sessions(signup_session_ref) on delete cascade,
  email_contact_ref text not null,
  phone_contact_ref text not null,
  channel text not null check (channel in ('kakao_simulated', 'kakao_alimtalk', 'sms_fallback')),
  verified_at timestamptz not null,
  consumed_at timestamptz,
  auth_user_id text,
  created_at timestamptz not null default now()
);

create index if not exists signup_contact_receipts_session_idx
  on signup_contact_receipts (signup_session_ref, consumed_at);

comment on table signup_contact_sessions is
  'Trusted DanjiOn signup contact state. Phone verification proves contact possession only; never resident or legal identity authority.';
comment on table signup_contact_challenges is
  'Persisted Padiem contact-verification challenge state. Raw OTP is never stored.';
comment on table signup_contact_receipts is
  'One-time contact-possession verification receipts bound to the exact DanjiOn signup session and contact refs.';
