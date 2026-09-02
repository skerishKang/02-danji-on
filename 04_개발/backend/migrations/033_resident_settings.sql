-- DanjiOn resident settings v1.
-- Reuse canonical consent_records and resident_public_profiles instead of creating duplicate preference authorities.
-- recorded_at is the primary chronology; event_seq is a deterministic insertion-order tiebreaker.

alter table consent_records
  drop constraint if exists consent_records_consent_type_check;

alter table consent_records
  add constraint consent_records_consent_type_check
  check (consent_type in (
    'terms',
    'privacy',
    'resident_rules',
    'community_rules',
    'marketing',
    'service_notifications',
    'benefit_marketing'
  ));

alter table consent_records
  add column if not exists event_seq bigint generated always as identity;

create index if not exists idx_consent_records_user_type_latest
  on consent_records (user_id, consent_type, recorded_at desc, event_seq desc);

alter table resident_public_profiles
  add column if not exists is_discoverable boolean not null default true;

comment on column resident_public_profiles.is_discoverable is
  'When false, other verified residents cannot resolve this public profile; self access remains allowed.';

comment on column consent_records.event_seq is
  'Deterministic insertion-order tiebreaker when recorded_at timestamps are equal; recorded_at remains primary chronology.';
