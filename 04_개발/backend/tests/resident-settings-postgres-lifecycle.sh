#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/011_consent_authorization_audit.sql
"${psql_cmd[@]}" -f migrations/026_resident_public_profiles.sql
"${psql_cmd[@]}" -f migrations/033_resident_settings.sql

"${psql_cmd[@]}" <<'SQL'
insert into app_users (id, auth_user_id, display_name) values
  ('10000000-0000-4000-8000-000000000021', 'settings-user', '설정주민');

-- Existing profile rows must remain discoverable by default.
insert into resident_public_profiles (user_id, public_bio) values
  ('10000000-0000-4000-8000-000000000021', '공개소개');

do $$
declare
  discoverable boolean;
  invalid_failed boolean := false;
begin
  select is_discoverable into discoverable
  from resident_public_profiles
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid;
  if discoverable is not true then
    raise exception 'public profile default must preserve existing discoverability';
  end if;

  -- Canonical consent table accepts both new handoff-specific notification consent types.
  insert into consent_records (user_id, consent_type, policy_version, status, source)
  values
    ('10000000-0000-4000-8000-000000000021', 'service_notifications', 'service-notify-v1', 'accepted', 'web'),
    ('10000000-0000-4000-8000-000000000021', 'benefit_marketing', 'benefit-marketing-v1', 'accepted', 'web'),
    ('10000000-0000-4000-8000-000000000021', 'marketing', 'legacy-marketing-v1', 'accepted', 'web');

  -- A later withdrawal is a new event, not an update of consent history.
  insert into consent_records (
    user_id, consent_type, policy_version, status, source, withdrawn_at
  ) values (
    '10000000-0000-4000-8000-000000000021',
    'service_notifications', 'service-notify-v1', 'withdrawn', 'web', now()
  );

  begin
    insert into consent_records (user_id, consent_type, policy_version, status, source)
    values (
      '10000000-0000-4000-8000-000000000021', 'invented_setting', 'v1', 'accepted', 'web'
    );
  exception when check_violation then
    invalid_failed := true;
  end;
  if not invalid_failed then
    raise exception 'unknown consent type was not rejected by DB constraint';
  end if;

  update resident_public_profiles
  set is_discoverable = false
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid;

  select is_discoverable into discoverable
  from resident_public_profiles
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid;
  if discoverable is not false then
    raise exception 'public profile opt-out was not persisted';
  end if;
end $$;

-- Latest settings projection must select the newest append-only consent event.
do $$
declare
  service_status text;
  benefit_status text;
  service_count integer;
begin
  select status into service_status
  from consent_records
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid
    and consent_type = 'service_notifications'
  order by recorded_at desc, id desc
  limit 1;

  select status into benefit_status
  from consent_records
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid
    and consent_type = 'benefit_marketing'
  order by recorded_at desc, id desc
  limit 1;

  select count(*) into service_count
  from consent_records
  where user_id = '10000000-0000-4000-8000-000000000021'::uuid
    and consent_type = 'service_notifications';

  if service_status <> 'withdrawn' then
    raise exception 'latest service-notification consent should be withdrawn: %', service_status;
  end if;
  if benefit_status <> 'accepted' then
    raise exception 'latest benefit-marketing consent should be accepted: %', benefit_status;
  end if;
  if service_count <> 2 then
    raise exception 'consent history should remain append-only, got % rows', service_count;
  end if;
end $$;

-- Migration 033 itself must not create a second settings/preferences table.
do $$
declare
  duplicate_tables integer;
begin
  select count(*) into duplicate_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('settings','user_settings','resident_settings','user_preferences','resident_preferences');
  if duplicate_tables <> 0 then
    raise exception 'duplicate settings authority table exists';
  end if;
end $$;
SQL

echo "PASS resident settings PostgreSQL lifecycle: canonical consent types/history, legacy compatibility and public-profile opt-out"
