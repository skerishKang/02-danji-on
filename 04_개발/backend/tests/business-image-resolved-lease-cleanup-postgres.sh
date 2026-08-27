#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_ID='71111111-1111-4111-8111-111111111111'
COMPLEX_ID='72222222-2222-4222-8222-222222222222'
LEASE_A='73333333-3333-4333-8333-333333333333'
LEASE_B='74444444-4444-4444-8444-444444444444'
KEY_BACKFILL_ACTIVE='gdrive/public/business-image/resolved_backfill_active_1234567890'
KEY_BACKFILL_RETIRED='gdrive/public/business-image/resolved_backfill_retired_1234567890'
KEY_PENDING_UPLOAD='gdrive/public/business-image/resolved_pending_upload_1234567890'
KEY_PENDING_DELETE='gdrive/public/business-image/resolved_pending_delete_1234567890'
KEY_FOREGROUND_ACTIVE='gdrive/public/business-image/resolved_foreground_active_1234567890'
KEY_FOREGROUND_RETIRED='gdrive/public/business-image/resolved_foreground_retired_1234567890'

assert_scalar() {
  local sql="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual=$("${PSQL[@]}" -Atc "$sql" | tr -d '[:space:]')
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL $label: expected=$expected actual=$actual" >&2
    exit 1
  fi
  echo "PASS $label: $actual"
}

# Minimal prerequisite product schema. Apply repository migrations in exact
# stacked order through 022 first so migration 023 can be tested as a true
# backfill + invariant boundary rather than duplicating its DDL in this probe.
"${PSQL[@]}" <<SQL
create extension if not exists pgcrypto;
drop table if exists business_image_objects cascade;
drop table if exists complexes cascade;
drop table if exists app_users cascade;

create table app_users (
  id uuid primary key,
  auth_user_id text not null unique,
  display_name text not null
);
create table complexes (
  id uuid primary key,
  slug text not null unique,
  name text not null
);
insert into app_users (id, auth_user_id, display_name)
values ('$USER_ID', 'resolved-lease-ci-user', 'Resolved Lease CI');
insert into complexes (id, slug, name)
values ('$COMPLEX_ID', 'resolved-lease-ci-complex', 'Resolved Lease CI Complex');
SQL

"${PSQL[@]}" -f migrations/019_business_image_lifecycle_registry.sql
"${PSQL[@]}" -f migrations/020_business_image_upload_pending.sql
"${PSQL[@]}" -f migrations/021_business_image_reconciliation_lease.sql
"${PSQL[@]}" -f migrations/022_business_image_upload_idempotency.sql

# ---------------------------------------------------------------------------
# Pre-023 historical rows: reproduce the exact stale-metadata shape that can
# occur when foreground resolution wins after a background claim.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_BACKFILL_ACTIVE', '$USER_ID', '$COMPLEX_ID', 'active',
  '$LEASE_A'::uuid, now() + interval '5 minutes',
  3, now() + interval '15 minutes',
  'UPLOAD_OBJECT_NOT_FOUND', now() - interval '1 minute'
);

insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  delete_requested_at, retired_at,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_BACKFILL_RETIRED', '$USER_ID', '$COMPLEX_ID', 'retired',
  now() - interval '10 minutes', now() - interval '5 minutes',
  '$LEASE_B'::uuid, now() + interval '5 minutes',
  4, now() + interval '1 hour',
  'DRIVE_TRASH_UNAVAILABLE', now() - interval '2 minutes'
);
SQL

"${PSQL[@]}" -f migrations/023_business_image_resolved_reconciliation_cleanup.sql

assert_scalar "select count(*) from business_image_objects where object_key='$KEY_BACKFILL_ACTIVE' and reconcile_lease_token is null and reconcile_lease_expires_at is null and reconcile_next_attempt_at is null and reconcile_last_error_code is null" "1" "RESOLVED backfill clears active live reconciliation metadata"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_BACKFILL_ACTIVE'" "3" "RESOLVED backfill preserves active attempt count"
assert_scalar "select (reconcile_last_attempt_at is not null)::int from business_image_objects where object_key='$KEY_BACKFILL_ACTIVE'" "1" "RESOLVED backfill preserves active last-attempt history"

assert_scalar "select count(*) from business_image_objects where object_key='$KEY_BACKFILL_RETIRED' and reconcile_lease_token is null and reconcile_lease_expires_at is null and reconcile_next_attempt_at is null and reconcile_last_error_code is null" "1" "RESOLVED backfill clears retired live reconciliation metadata"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_BACKFILL_RETIRED'" "4" "RESOLVED backfill preserves retired attempt count"
assert_scalar "select (reconcile_last_attempt_at is not null)::int from business_image_objects where object_key='$KEY_BACKFILL_RETIRED'" "1" "RESOLVED backfill preserves retired last-attempt history"

# ---------------------------------------------------------------------------
# Pending compatibility: migration 023 must not remove valid finite lease or
# retry scheduling semantics from unresolved rows.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_PENDING_UPLOAD', '$USER_ID', '$COMPLEX_ID', 'upload_pending',
  '$LEASE_A'::uuid, now() + interval '5 minutes',
  2, now() + interval '10 minutes',
  'UPLOAD_OBJECT_NOT_FOUND', now()
);

insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, delete_requested_at,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_PENDING_DELETE', '$USER_ID', '$COMPLEX_ID', 'delete_pending', now(),
  '$LEASE_B'::uuid, now() + interval '5 minutes',
  2, now() + interval '10 minutes',
  'DRIVE_TRASH_UNAVAILABLE', now()
);
SQL
assert_scalar "select count(*) from business_image_objects where object_key in ('$KEY_PENDING_UPLOAD','$KEY_PENDING_DELETE') and reconcile_lease_token is not null and reconcile_next_attempt_at is not null" "2" "RESOLVED constraint preserves valid pending leases"

# ---------------------------------------------------------------------------
# Foreground activation wins after a committed background claim. The state
# transition itself clears live lease/schedule metadata; the old worker token
# becomes stale while attempt history remains observable.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_FOREGROUND_ACTIVE', '$USER_ID', '$COMPLEX_ID', 'upload_pending',
  '$LEASE_A'::uuid, now() + interval '5 minutes',
  5, now() + interval '15 minutes',
  'UPLOAD_OBJECT_NOT_FOUND', now()
);

update business_image_objects
set state='active',
    reconcile_lease_token=null,
    reconcile_lease_expires_at=null,
    reconcile_next_attempt_at=null,
    reconcile_last_error_code=null,
    updated_at=now()
where object_key='$KEY_FOREGROUND_ACTIVE'
  and uploader_user_id='$USER_ID'::uuid
  and complex_id='$COMPLEX_ID'::uuid
  and state='upload_pending';
SQL
assert_scalar "select state from business_image_objects where object_key='$KEY_FOREGROUND_ACTIVE'" "active" "FOREGROUND activation resolves leased upload"
assert_scalar "select count(*) from business_image_objects where object_key='$KEY_FOREGROUND_ACTIVE' and reconcile_lease_token is null and reconcile_lease_expires_at is null and reconcile_next_attempt_at is null and reconcile_last_error_code is null" "1" "FOREGROUND activation clears live reconciliation metadata"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_FOREGROUND_ACTIVE'" "5" "FOREGROUND activation preserves attempt count"
assert_scalar "select (reconcile_last_attempt_at is not null)::int from business_image_objects where object_key='$KEY_FOREGROUND_ACTIVE'" "1" "FOREGROUND activation preserves last-attempt history"

STALE_UPLOAD=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with stale as (
  update business_image_objects
  set reconcile_next_attempt_at=now()+interval '1 minute',
      reconcile_last_error_code='STALE_BACKGROUND_SHOULD_NOT_WRITE',
      reconcile_lease_token=null,
      reconcile_lease_expires_at=null,
      updated_at=now()
  where object_key='$KEY_FOREGROUND_ACTIVE'
    and state='upload_pending'
    and reconcile_lease_token='$LEASE_A'::uuid
  returning object_key
)
select count(*) from stale;
SQL
)
if [[ "$STALE_UPLOAD" != "0" ]]; then
  echo "FAIL FOREGROUND activation stale background token: expected=0 actual=$STALE_UPLOAD" >&2
  exit 1
fi
echo "PASS FOREGROUND activation invalidates background token: $STALE_UPLOAD"

# ---------------------------------------------------------------------------
# Foreground retirement has the same ownership invalidation semantics.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, delete_requested_at,
  reconcile_lease_token, reconcile_lease_expires_at,
  reconcile_attempt_count, reconcile_next_attempt_at,
  reconcile_last_error_code, reconcile_last_attempt_at
) values (
  '$KEY_FOREGROUND_RETIRED', '$USER_ID', '$COMPLEX_ID', 'delete_pending', now() - interval '1 minute',
  '$LEASE_B'::uuid, now() + interval '5 minutes',
  6, now() + interval '15 minutes',
  'DRIVE_TRASH_UNAVAILABLE', now()
);

update business_image_objects
set state='retired',
    retired_at=coalesce(retired_at, now()),
    reconcile_lease_token=null,
    reconcile_lease_expires_at=null,
    reconcile_next_attempt_at=null,
    reconcile_last_error_code=null,
    updated_at=now()
where object_key='$KEY_FOREGROUND_RETIRED'
  and state='delete_pending';
SQL
assert_scalar "select state from business_image_objects where object_key='$KEY_FOREGROUND_RETIRED'" "retired" "FOREGROUND retirement resolves leased delete"
assert_scalar "select count(*) from business_image_objects where object_key='$KEY_FOREGROUND_RETIRED' and reconcile_lease_token is null and reconcile_lease_expires_at is null and reconcile_next_attempt_at is null and reconcile_last_error_code is null" "1" "FOREGROUND retirement clears live reconciliation metadata"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_FOREGROUND_RETIRED'" "6" "FOREGROUND retirement preserves attempt count"
assert_scalar "select (reconcile_last_attempt_at is not null)::int from business_image_objects where object_key='$KEY_FOREGROUND_RETIRED'" "1" "FOREGROUND retirement preserves last-attempt history"

STALE_DELETE=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with stale as (
  update business_image_objects
  set reconcile_next_attempt_at=now()+interval '1 minute',
      reconcile_last_error_code='STALE_BACKGROUND_SHOULD_NOT_WRITE',
      reconcile_lease_token=null,
      reconcile_lease_expires_at=null,
      updated_at=now()
  where object_key='$KEY_FOREGROUND_RETIRED'
    and state='delete_pending'
    and reconcile_lease_token='$LEASE_B'::uuid
  returning object_key
)
select count(*) from stale;
SQL
)
if [[ "$STALE_DELETE" != "0" ]]; then
  echo "FAIL FOREGROUND retirement stale background token: expected=0 actual=$STALE_DELETE" >&2
  exit 1
fi
echo "PASS FOREGROUND retirement invalidates background token: $STALE_DELETE"

# ---------------------------------------------------------------------------
# Durable fail-closed invariant: resolved rows cannot be persisted with live
# reconciliation ownership or retry scheduling metadata.
# ---------------------------------------------------------------------------
if "${PSQL[@]}" -c "update business_image_objects set reconcile_lease_token='$LEASE_A'::uuid, reconcile_lease_expires_at=now()+interval '5 minutes' where object_key='$KEY_FOREGROUND_ACTIVE'" >/dev/null 2>&1; then
  echo "FAIL RESOLVED constraint allowed active live lease" >&2
  exit 1
fi
echo "PASS RESOLVED constraint rejects active live lease"

if "${PSQL[@]}" -c "update business_image_objects set reconcile_next_attempt_at=now()+interval '5 minutes', reconcile_last_error_code='INVALID_RESOLVED_RETRY' where object_key='$KEY_FOREGROUND_RETIRED'" >/dev/null 2>&1; then
  echo "FAIL RESOLVED constraint allowed retired retry schedule" >&2
  exit 1
fi
echo "PASS RESOLVED constraint rejects retired retry schedule"

assert_scalar "select count(*) from business_image_objects where state in ('active','retired') and (reconcile_lease_token is not null or reconcile_lease_expires_at is not null or reconcile_next_attempt_at is not null or reconcile_last_error_code is not null)" "0" "RESOLVED final registry has no pending-only live metadata"

echo "PASS PostgreSQL 18 business-image resolved-state reconciliation cleanup: BACKFILL_CLEARS_LIVE_METADATA; HISTORY_PRESERVED; PENDING_COMPATIBLE; FOREGROUND_ACTIVE_INVALIDATES_BACKGROUND; FOREGROUND_RETIRED_INVALIDATES_BACKGROUND; RESOLVED_CONSTRAINT_FAILS_CLOSED"
