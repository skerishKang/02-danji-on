#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local sql="$2"
  local output
  output="$(mktemp)"
  if "${psql_cmd[@]}" -c "$sql" >"$output" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$output"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
  echo "PASS ${label}"
}

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/017_account_lifecycle.sql
"${psql_cmd[@]}" -f migrations/026_resident_public_profiles.sql

"${psql_cmd[@]}" <<'SQL'
insert into app_users (id, auth_user_id, display_name, avatar_url) values (
  '20000000-0000-4000-8000-000000000001',
  'sub-profile-a',
  'Neighbor A',
  'https://example.com/avatar-a.png'
);

insert into resident_public_profiles (user_id, public_bio) values (
  '20000000-0000-4000-8000-000000000001',
  'Hello neighbors'
);

select pg_sleep(0.02);
update resident_public_profiles
set public_bio = 'Updated public introduction'
where user_id = '20000000-0000-4000-8000-000000000001';

do $$
declare
  profile_count integer;
  stored_bio text;
  created_ts timestamptz;
  updated_ts timestamptz;
begin
  select count(*) into profile_count from resident_public_profiles;
  if profile_count <> 1 then
    raise exception 'expected one profile row, got %', profile_count;
  end if;

  select public_bio, created_at, updated_at
  into stored_bio, created_ts, updated_ts
  from resident_public_profiles
  where user_id = '20000000-0000-4000-8000-000000000001';

  if stored_bio <> 'Updated public introduction' then
    raise exception 'profile update was not persisted: %', stored_bio;
  end if;
  if updated_ts <= created_ts then
    raise exception 'updated_at trigger did not advance: created=% updated=%', created_ts, updated_ts;
  end if;
end $$;
SQL

expect_fail \
  "profile bio length bound" \
  "insert into resident_public_profiles (user_id, public_bio) values ('20000000-0000-4000-8000-000000000001', repeat('x', 301)) on conflict (user_id) do update set public_bio = excluded.public_bio"

expect_fail \
  "profile user FK" \
  "insert into resident_public_profiles (user_id, public_bio) values ('20000000-0000-4000-8000-000000000099', 'ghost')"

echo "PASS resident profile PostgreSQL lifecycle: migrations 001+017+026, 1:1 user FK, bio bound, updated-at trigger"
