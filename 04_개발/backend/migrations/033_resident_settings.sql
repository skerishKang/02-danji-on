-- DanjiOn resident settings v1.
-- Reuse canonical consent_records and resident_public_profiles instead of creating duplicate preference authorities.

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

alter table resident_public_profiles
  add column if not exists is_discoverable boolean not null default true;

comment on column resident_public_profiles.is_discoverable is
  'When false, other verified residents cannot resolve this public profile; self access remains allowed.';
