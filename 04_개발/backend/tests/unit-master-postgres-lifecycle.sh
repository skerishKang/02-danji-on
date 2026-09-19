#!/usr/bin/env bash
# Issue #776: Authoritative unit master and operator provenance PostgreSQL lifecycle.
# Proves 055 applies against real PostgreSQL:
# 1. Base migrations (001, 009, 011, 012) apply cleanly.
# 2. Historical units from before 055 survive with null provenance & null deactivated_at.
# 3. 055 applies cleanly, rerun is idempotent.
# 4. Provenance columns exist and reject resident PII columns.
# 5. Atomic CTE failure injection: forced audit failure on create rolls back unit row.
# 6. Atomic CTE failure injection: forced audit failure on update rolls back unit code/status.
# 7. Atomic CTE create writes exactly 1 unit-master.create audit row.
# 8. Atomic CTE code update writes exactly 1 unit-master.update audit row.
# 9. Atomic CTE status transition writes unit-master.status audit rows.
# 10. Household FK constraint remains intact on status changes; hard delete is restricted.
# 11. Active filter (as used in household-master-v2) excludes deactivated units.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (scratch database only)}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local out
  out="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$out" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$out"
    rm -f "$out"
    exit 1
  fi
  rm -f "$out"
  echo "PASS ${label}"
}

expect_scalar() {
  local label="$1"
  local expected="$2"
  local query="$3"
  local actual
  actual="$("${psql_cmd[@]}" -At -c "$query")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL ${label}: expected [$expected] got [$actual]"
    exit 1
  fi
  echo "PASS ${label}"
}

# ------------------------------------------------------------------ 1. Apply base schema
"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/009_household_foundation.sql
"${psql_cmd[@]}" -f migrations/011_consent_authorization_audit.sql
"${psql_cmd[@]}" -f migrations/012_padiem_operator_grants.sql
echo "PASS base migrations applied"

# ------------------------------------------------------------------ 2. Seed pre-055 foundation data
"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('70000000-0000-4000-8000-000000000001', 'banglim-myeongji-roadhill', '방림명지로드힐', 'active')
on conflict (id) do nothing;

insert into app_users (id, auth_user_id, display_name) values
  ('71000000-0000-4000-8000-000000000001', 'operator-auth-1', '운영자1')
on conflict (id) do nothing;

-- Historical unit before 055 migration existed
insert into complex_units (id, complex_id, building_code, unit_code, status) values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '101', '101', 'active')
on conflict (id) do nothing;
SQL
echo "PASS pre-055 historical unit seeded"

# ------------------------------------------------------------------ 3. Apply migration 055 & verify idempotency
"${psql_cmd[@]}" -f migrations/055_complex_unit_master_provenance.sql
echo "PASS 055 first apply exits 0"

"${psql_cmd[@]}" -f migrations/055_complex_unit_master_provenance.sql
echo "PASS 055 rerun is idempotent"

# ------------------------------------------------------------------ 4. Verify columns & comments
expect_scalar 'created_by_user_id column is uuid and nullable' \
  'uuid|YES' \
  "select data_type || '|' || is_nullable
   from information_schema.columns
   where table_name = 'complex_units' and column_name = 'created_by_user_id'"

expect_scalar 'updated_by_user_id column is uuid and nullable' \
  'uuid|YES' \
  "select data_type || '|' || is_nullable
   from information_schema.columns
   where table_name = 'complex_units' and column_name = 'updated_by_user_id'"

expect_scalar 'deactivated_at column is timestamptz and nullable' \
  'timestamp with time zone|YES' \
  "select data_type || '|' || is_nullable
   from information_schema.columns
   where table_name = 'complex_units' and column_name = 'deactivated_at'"

# Verify no PII columns exist on complex_units
expect_scalar 'no resident PII columns exist in complex_units' \
  '0' \
  "select count(*)
   from information_schema.columns
   where table_name = 'complex_units'
     and column_name in ('resident_name', 'name', 'phone', 'phone_number', 'email', 'roster', 'ssn')"

# Historical unit preserved with NULL provenance and NULL deactivated_at
expect_scalar 'historical unit has null provenance and null deactivated_at' \
  '101|101|active|||' \
  "select building_code || '|' || unit_code || '|' || status || '|' ||
          coalesce(created_by_user_id::text, '') || '|' ||
          coalesce(updated_by_user_id::text, '') || '|' ||
          coalesce(deactivated_at::text, '')
   from complex_units
   where id = '72000000-0000-4000-8000-000000000001'"

# ------------------------------------------------------------------ 5. Setup failure injection trigger
"${psql_cmd[@]}" <<'SQL'
create or replace function trg_audit_events_fail_injection()
returns trigger as $$
begin
  if new.request_id like 'fail-audit-%' then
    raise exception 'FORCED_AUDIT_FAILURE_INJECTION: request_id=%', new.request_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_audit_events_fail_injection on audit_events;
create trigger trg_audit_events_fail_injection
  before insert on audit_events
  for each row execute function trg_audit_events_fail_injection();
SQL
echo "PASS audit failure-injection trigger installed"

# ------------------------------------------------------------------ 6. Failure injection: Create + forced audit failure
expect_fail 'create + forced audit failure aborts CTE transaction' \
"with inserted as (
  insert into complex_units (
    id, complex_id, building_code, unit_code, status,
    created_by_user_id, updated_by_user_id
  ) values (
    '72000000-0000-4000-8000-000000000099',
    '70000000-0000-4000-8000-000000000001',
    '999', '999', 'active',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001'
  )
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'fail-audit-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    inserted.complex_id,
    'unit-master.create',
    'resident.verification.manage',
    'complex_unit',
    inserted.id::text,
    'recorded',
    '{\"buildingCode\": \"999\", \"unitCode\": \"999\", \"status\": \"active\"}'::jsonb
  from inserted
  returning id
)
select inserted.id from inserted join audited on true;"

expect_scalar 'unit 999/999 was not inserted into complex_units' \
  '0' \
  "select count(*) from complex_units where building_code = '999' and unit_code = '999'"

expect_scalar 'no audit event recorded for fail-audit-create' \
  '0' \
  "select count(*) from audit_events where request_id = 'fail-audit-create'"

# ------------------------------------------------------------------ 7. Failure injection: Update + forced audit failure
expect_fail 'update + forced audit failure aborts CTE transaction' \
"with changed as (
  update complex_units
  set building_code = '101',
      unit_code = '888',
      status = 'inactive',
      deactivated_at = now(),
      updated_by_user_id = '71000000-0000-4000-8000-000000000001',
      updated_at = now()
  where id = '72000000-0000-4000-8000-000000000001'
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'fail-audit-update',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    changed.complex_id,
    'unit-master.update',
    'resident.verification.manage',
    'complex_unit',
    changed.id::text,
    'recorded',
    '{\"previousUnitCode\": \"101\", \"newUnitCode\": \"888\"}'::jsonb
  from changed
  returning id
)
select changed.id from changed join audited on true;"

expect_scalar 'historical unit remains unchanged after aborted update' \
  '101|101|active|||' \
  "select building_code || '|' || unit_code || '|' || status || '|' ||
          coalesce(created_by_user_id::text, '') || '|' ||
          coalesce(updated_by_user_id::text, '') || '|' ||
          coalesce(deactivated_at::text, '')
   from complex_units
   where id = '72000000-0000-4000-8000-000000000001'"

expect_scalar 'no audit event recorded for fail-audit-update' \
  '0' \
  "select count(*) from audit_events where request_id = 'fail-audit-update'"

# ------------------------------------------------------------------ 8. Operator create unit via atomic CTE
"${psql_cmd[@]}" <<'SQL'
with inserted as (
  insert into complex_units (
    id, complex_id, building_code, unit_code, status,
    created_by_user_id, updated_by_user_id
  ) values (
    '72000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    '101', '102', 'active',
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001'
  )
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'req-test-pg-create',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    inserted.complex_id,
    'unit-master.create',
    'resident.verification.manage',
    'complex_unit',
    inserted.id::text,
    'recorded',
    '{"buildingCode": "101", "unitCode": "102", "status": "active"}'::jsonb
  from inserted
  returning id
)
select inserted.id, inserted.building_code, inserted.unit_code, inserted.status
from inserted
join audited on true;
SQL
echo "PASS operator created active unit with atomic provenance and audit log"

expect_scalar 'unit 101/102 exists with active status' \
  '101|102|active' \
  "select building_code || '|' || unit_code || '|' || status
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

expect_scalar 'exactly 1 unit-master.create audit row exists' \
  '1' \
  "select count(*) from audit_events where action = 'unit-master.create'"

# Reject duplicate unit in same complex
expect_fail 'duplicate unit code rejected by unique constraint' \
  "insert into complex_units (complex_id, building_code, unit_code, status) values
   ('70000000-0000-4000-8000-000000000001', '101', '102', 'active')"

# ------------------------------------------------------------------ 9. Unit code update via atomic CTE
"${psql_cmd[@]}" <<'SQL'
with changed as (
  update complex_units
  set building_code = '101',
      unit_code = '103',
      status = 'active',
      deactivated_at = null,
      updated_by_user_id = '71000000-0000-4000-8000-000000000001',
      updated_at = now()
  where id = '72000000-0000-4000-8000-000000000002'
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'req-test-pg-update',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    changed.complex_id,
    'unit-master.update',
    'resident.verification.manage',
    'complex_unit',
    changed.id::text,
    'recorded',
    '{"previousUnitCode": "102", "newUnitCode": "103"}'::jsonb
  from changed
  returning id
)
select changed.id, changed.building_code, changed.unit_code, changed.status
from changed
join audited on true;
SQL
echo "PASS unit code updated via atomic CTE"

expect_scalar 'unit code updated to 103' \
  '101|103|active' \
  "select building_code || '|' || unit_code || '|' || status
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

expect_scalar 'exactly 1 unit-master.update audit row exists' \
  '1' \
  "select count(*) from audit_events where action = 'unit-master.update'"

# ------------------------------------------------------------------ 10. Unit deactivation via atomic CTE
"${psql_cmd[@]}" <<'SQL'
with changed as (
  update complex_units
  set building_code = '101',
      unit_code = '103',
      status = 'inactive',
      deactivated_at = now(),
      updated_by_user_id = '71000000-0000-4000-8000-000000000001',
      updated_at = now()
  where id = '72000000-0000-4000-8000-000000000002'
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'req-test-pg-deactivate',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    changed.complex_id,
    'unit-master.status',
    'resident.verification.manage',
    'complex_unit',
    changed.id::text,
    'recorded',
    '{"previousStatus": "active", "newStatus": "inactive"}'::jsonb
  from changed
  returning id
)
select changed.id, changed.status, changed.deactivated_at
from changed
join audited on true;
SQL

expect_scalar 'deactivated unit has inactive status and non-null deactivated_at with same UUID' \
  '72000000-0000-4000-8000-000000000002|inactive|NOT_NULL' \
  "select id || '|' || status || '|' || case when deactivated_at is not null then 'NOT_NULL' else 'NULL' end
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

expect_scalar 'exactly 1 unit-master.status audit row exists after deactivation' \
  '1' \
  "select count(*) from audit_events where action = 'unit-master.status'"

# ------------------------------------------------------------------ 11. Unit reactivation via atomic CTE
"${psql_cmd[@]}" <<'SQL'
with changed as (
  update complex_units
  set building_code = '101',
      unit_code = '103',
      status = 'active',
      deactivated_at = null,
      updated_by_user_id = '71000000-0000-4000-8000-000000000001',
      updated_at = now()
  where id = '72000000-0000-4000-8000-000000000002'
  returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
), audited as (
  insert into audit_events (
    request_id, actor_user_id, actor_kind, complex_id, action, scope,
    resource_type, resource_id, decision, metadata
  )
  select
    'req-test-pg-reactivate',
    '71000000-0000-4000-8000-000000000001'::uuid,
    'operator',
    changed.complex_id,
    'unit-master.status',
    'resident.verification.manage',
    'complex_unit',
    changed.id::text,
    'recorded',
    '{"previousStatus": "inactive", "newStatus": "active"}'::jsonb
  from changed
  returning id
)
select changed.id, changed.status, changed.deactivated_at
from changed
join audited on true;
SQL

expect_scalar 'reactivated unit has active status and null deactivated_at' \
  '72000000-0000-4000-8000-000000000002|active|NULL' \
  "select id || '|' || status || '|' || case when deactivated_at is not null then 'NOT_NULL' else 'NULL' end
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

expect_scalar 'exactly 2 unit-master.status audit rows exist after reactivation' \
  '2' \
  "select count(*) from audit_events where action = 'unit-master.status'"

# ------------------------------------------------------------------ 12. Household FK integrity
"${psql_cmd[@]}" <<'SQL'
-- Connect household to unit
insert into households (id, complex_id, complex_unit_id, status) values
  ('73000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'active');
SQL

# Soft-deactivating the unit must succeed without breaking household reference
"${psql_cmd[@]}" <<'SQL'
update complex_units
set status = 'inactive',
    deactivated_at = now()
where id = '72000000-0000-4000-8000-000000000002';
SQL
echo "PASS unit status toggle does not violate household FK constraint"

# Hard DELETE on referenced unit must fail closed with FK restrict violation
expect_fail 'hard delete on occupied complex_unit is restricted' \
  "delete from complex_units where id = '72000000-0000-4000-8000-000000000002'"

# ------------------------------------------------------------------ 13. Resident onboarding query
# household-master-v2 query: select ... from complex_units where complex_id = ... and status = 'active'
# Unit 101 is active, Unit 103 is inactive
expect_scalar 'active filter excludes inactive unit from resident picker' \
  '1' \
  "select count(*)
   from complex_units
   where complex_id = '70000000-0000-4000-8000-000000000001'
     and status = 'active'"

expect_scalar 'total count includes both active and inactive units' \
  '2' \
  "select count(*)
   from complex_units
   where complex_id = '70000000-0000-4000-8000-000000000001'"

# ------------------------------------------------------------------ 14. Audit log completeness
expect_scalar 'all four unit-master audit actions exist in audit_events' \
  '4' \
  "select count(*)
   from audit_events
   where action in ('unit-master.create', 'unit-master.update', 'unit-master.status')"

echo "PASS unit-master PostgreSQL lifecycle verified successfully"
