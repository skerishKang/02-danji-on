-- Owner preview #762: nickname change cooldown metadata.
-- Additive only; no existing profile data is rewritten.
alter table resident_public_profiles
  add column if not exists nickname_changed_at timestamptz;

comment on column resident_public_profiles.nickname_changed_at is
  'Last successful user-requested nickname change; enforces the owner-approved 30-day cooldown.';
