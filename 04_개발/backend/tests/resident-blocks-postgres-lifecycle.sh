#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local output
  output="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$output" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$output"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
  echo "PASS ${label}"
}

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql

"${psql_cmd[@]}" <<'SQL'
insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'blocker-a', 'Blocker A'),
  ('20000000-0000-4000-8000-000000000002', 'blocked-b', 'Blocked B');

insert into blocks (blocker_user_id, blocked_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');

insert into blocks (blocker_user_id, blocked_user_id) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')
on conflict (blocker_user_id, blocked_user_id) do nothing;
SQL

expect_fail \
  "self block rejected" \
  "insert into blocks (blocker_user_id,blocked_user_id) values ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001')"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  block_count integer;
begin
  select count(*) into block_count
  from blocks
  where blocker_user_id = '20000000-0000-4000-8000-000000000001'
    and blocked_user_id = '20000000-0000-4000-8000-000000000002';
  if block_count <> 1 then
    raise exception 'idempotent block relation expected exactly one row, got %', block_count;
  end if;
end $$;

delete from blocks
where blocker_user_id = '20000000-0000-4000-8000-000000000001'
  and blocked_user_id = '20000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1 from blocks
    where blocker_user_id = '20000000-0000-4000-8000-000000000001'
      and blocked_user_id = '20000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'unblock did not remove relation';
  end if;
end $$;
SQL

echo "PASS resident blocks PostgreSQL lifecycle: uniqueness, self-block guard, unblock removal"
