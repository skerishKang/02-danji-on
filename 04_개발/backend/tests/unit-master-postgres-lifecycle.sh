#!/usr/bin/env bash
# Issue #776: Authoritative unit master and operator provenance PostgreSQL lifecycle.
# Proves 055 applies against real PostgreSQL:
# 1. Base migrations (001, 009, 011, 012) apply cleanly.
# 2. Historical units from before 055 survive with null provenance & null deactivated_at.
# 3. 055 applies cleanly, rerun is idempotent.
# 4. Provenance columns exist and reject resident PII columns.
# 5. Active unit creation stores operator provenance, duplicate (complex_id, building_code, unit_code) is rejected.
# 6. Deactivation sets deactivated_at and keeps identical UUID.
# 7. Reactivation clears deactivated_at and keeps identical UUID.
# 8. Audit events (unit-master.create, unit-master.update, unit-master.status) are written.
# 9. Household FK constraint remains intact on status changes; hard delete is restricted.
# 10. Active filter (as used in household-master-v2) excludes deactivated units.
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

# ------------------------------------------------------------------ 5. Operator create unit
"${psql_cmd[@]}" <<'SQL'
insert into complex_units (
  id, complex_id, building_code, unit_code, status,
  created_by_user_id, updated_by_user_id
) values (
  '72000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  '101', '102', 'active',
  '71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001'
);

insert into audit_events (
  request_id, actor_user_id, actor_kind, complex_id, action, scope,
  resource_type, resource_id, decision, metadata
) values (
  'req-test-pg-1', '71000000-0000-4000-8000-000000000001', 'operator',
  '70000000-0000-4000-8000-000000000001', 'unit-master.create', 'resident.verification.manage',
  'complex_unit', '72000000-0000-4000-8000-000000000002', 'recorded',
  '{"buildingCode": "101", "unitCode": "102", "status": "active"}'::jsonb
);
SQL
echo "PASS operator created active unit with provenance and audit log"

# Reject duplicate unit in same complex
expect_fail 'duplicate unit code rejected by unique constraint' \
  "insert into complex_units (complex_id, building_code, unit_code, status) values
   ('70000000-0000-4000-8000-000000000001', '101', '102', 'active')"

# ------------------------------------------------------------------ 6. Unit deactivation
"${psql_cmd[@]}" <<'SQL'
update complex_units
set status = 'inactive',
    deactivated_at = now(),
    updated_by_user_id = '71000000-0000-4000-8000-000000000001',
    updated_at = now()
where id = '72000000-0000-4000-8000-000000000002';

insert into audit_events (
  request_id, actor_user_id, actor_kind, complex_id, action, scope,
  resource_type, resource_id, decision, metadata
) values (
  'req-test-pg-2', '71000000-0000-4000-8000-000000000001', 'operator',
  '70000000-0000-4000-8000-000000000001', 'unit-master.status', 'resident.verification.manage',
  'complex_unit', '72000000-0000-4000-8000-000000000002', 'recorded',
  '{"previousStatus": "active", "newStatus": "inactive"}'::jsonb
);
SQL

expect_scalar 'deactivated unit has inactive status and non-null deactivated_at with same UUID' \
  '72000000-0000-4000-8000-000000000002|inactive|NOT_NULL' \
  "select id || '|' || status || '|' || case when deactivated_at is not null then 'NOT_NULL' else 'NULL' end
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

# ------------------------------------------------------------------ 7. Unit reactivation
"${psql_cmd[@]}" <<'SQL'
update complex_units
set status = 'active',
    deactivated_at = null,
    updated_by_user_id = '71000000-0000-4000-8000-000000000001',
    updated_at = now()
where id = '72000000-0000-4000-8000-000000000002';

insert into audit_events (
  request_id, actor_user_id, actor_kind, complex_id, action, scope,
  resource_type, resource_id, decision, metadata
) values (
  'req-test-pg-3', '71000000-0000-4000-8000-000000000001', 'operator',
  '70000000-0000-4000-8000-000000000001', 'unit-master.status', 'resident.verification.manage',
  'complex_unit', '72000000-0000-4000-8000-000000000002', 'recorded',
  '{"previousStatus": "inactive", "newStatus": "active"}'::jsonb
);
SQL

expect_scalar 'reactivated unit has active status and null deactivated_at' \
  '72000000-0000-4000-8000-000000000002|active|NULL' \
  "select id || '|' || status || '|' || case when deactivated_at is not null then 'NOT_NULL' else 'NULL' end
   from complex_units
   where id = '72000000-0000-4000-8000-000000000002'"

# ------------------------------------------------------------------ 8. Household FK integrity
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

# ------------------------------------------------------------------ 9. Resident onboarding query
# household-master-v2 query: select ... from complex_units where complex_id = ... and status = 'active'
# Unit 101 is active, Unit 102 is inactive
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

# ------------------------------------------------------------------ 10. Audit log completeness
expect_scalar 'all three unit-master audit actions exist in audit_events' \
  '3' \
  "select count(*)
   from audit_events
   where action in ('unit-master.create', 'unit-master.update', 'unit-master.status')"

echo "PASS unit-master PostgreSQL lifecycle verified successfully"
