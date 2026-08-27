#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_ID='11111111-1111-4111-8111-111111111111'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
KEY_UPLOAD='gdrive/public/business-image/upload_pending_1234567890'
KEY_REF_FIRST='gdrive/public/business-image/concurrency_ref_first_1234567890'
KEY_DELETE_FIRST='gdrive/public/business-image/concurrency_delete_first_1234567890'
KEY_LEASE_UPLOAD='gdrive/public/business-image/reconcile_upload_1234567890'
KEY_LEASE_DELETE='gdrive/public/business-image/reconcile_delete_1234567890'
KEY_LEASE_ACTIVE='gdrive/public/business-image/reconcile_active_1234567890'
LEASE_A='44444444-4444-4444-8444-444444444444'
LEASE_B='55555555-5555-4555-8555-555555555555'

# Minimal prerequisite product schema. Migrations 019/020/021 are applied from
# repository files below, so lifecycle/reconciliation DDL under test is not duplicated here.
"${PSQL[@]}" <<SQL
create extension if not exists pgcrypto;
drop table if exists business_media cascade;
drop table if exists business_applications cascade;
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
create table business_applications (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id),
  applicant_user_id uuid not null references app_users(id),
  relation_type text not null,
  business_name text not null,
  category_name text not null,
  service_summary text not null,
  representative_image_object_key text,
  status text not null default 'pending'
    check (status in ('draft','pending','changes_requested','approved','rejected'))
);
create table business_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  object_key text not null
);
insert into app_users (id, auth_user_id, display_name)
values ('$USER_ID', 'atomicity-ci-user', 'Atomicity CI');
insert into complexes (id, slug, name)
values ('$COMPLEX_ID', 'atomicity-ci-complex', 'Atomicity CI Complex');
SQL

"${PSQL[@]}" -f migrations/019_business_image_lifecycle_registry.sql
"${PSQL[@]}" -f migrations/020_business_image_upload_pending.sql
"${PSQL[@]}" -f migrations/021_business_image_reconciliation_lease.sql

cleanup_case() {
  local key="$1"
  "${PSQL[@]}" <<SQL
  delete from business_applications where representative_image_object_key = '$key';
  delete from business_media where object_key = '$key';
  delete from business_image_objects where object_key = '$key';
  insert into business_image_objects (object_key, uploader_user_id, complex_id, state)
  values ('$key', '$USER_ID', '$COMPLEX_ID', 'active');
SQL
}

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

# ---------------------------------------------------------------------------
# Upload lifecycle: a final object key is durably upload_pending before it can
# become active, and the extended state machine preserves the #109 retirement
# states after activation.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
delete from business_image_objects where object_key = '$KEY_UPLOAD';
insert into business_image_objects (object_key, uploader_user_id, complex_id, state)
values ('$KEY_UPLOAD', '$USER_ID', '$COMPLEX_ID', 'upload_pending');
SQL
assert_scalar "select state from business_image_objects where object_key='$KEY_UPLOAD'" "upload_pending" "UPLOAD lifecycle durable reservation"

"${PSQL[@]}" -c "update business_image_objects set state='active', updated_at=now() where object_key='$KEY_UPLOAD' and state='upload_pending'"
assert_scalar "select state from business_image_objects where object_key='$KEY_UPLOAD'" "active" "UPLOAD lifecycle activation"

"${PSQL[@]}" -c "update business_image_objects set state='delete_pending', delete_requested_at=now(), updated_at=now() where object_key='$KEY_UPLOAD' and state='active'"
assert_scalar "select state from business_image_objects where object_key='$KEY_UPLOAD'" "delete_pending" "UPLOAD lifecycle delete intent"

"${PSQL[@]}" -c "update business_image_objects set state='retired', retired_at=now(), updated_at=now() where object_key='$KEY_UPLOAD' and state='delete_pending'"
assert_scalar "select state from business_image_objects where object_key='$KEY_UPLOAD'" "retired" "UPLOAD lifecycle retirement"

# upload_pending must not satisfy the active predicate used by new product refs.
"${PSQL[@]}" <<SQL
delete from business_image_objects where object_key = '$KEY_UPLOAD';
insert into business_image_objects (object_key, uploader_user_id, complex_id, state)
values ('$KEY_UPLOAD', '$USER_ID', '$COMPLEX_ID', 'upload_pending');
SQL
assert_scalar "select count(*) from business_image_objects where object_key='$KEY_UPLOAD' and state='active'" "0" "UPLOAD_PENDING reference predicate denied"

# ---------------------------------------------------------------------------
# Background reconciliation lease: pending-only bounded claim, live-lease
# overlap exclusion, stale-token finalize denial and expired-lease reclaim.
# ---------------------------------------------------------------------------
"${PSQL[@]}" <<SQL
delete from business_image_objects where object_key in ('$KEY_LEASE_UPLOAD', '$KEY_LEASE_DELETE', '$KEY_LEASE_ACTIVE');
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, updated_at
) values (
  '$KEY_LEASE_UPLOAD', '$USER_ID', '$COMPLEX_ID', 'upload_pending', now() - interval '10 minutes'
);
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, delete_requested_at, updated_at
) values (
  '$KEY_LEASE_DELETE', '$USER_ID', '$COMPLEX_ID', 'delete_pending', now() - interval '10 minutes', now() - interval '10 minutes'
);
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, updated_at
) values (
  '$KEY_LEASE_ACTIVE', '$USER_ID', '$COMPLEX_ID', 'active', now() - interval '10 minutes'
);
SQL

CLAIM_A=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with candidates as (
  select bio.object_key
  from business_image_objects bio
  where bio.state in ('upload_pending', 'delete_pending')
    and bio.updated_at <= now() - interval '2 minutes'
    and (bio.reconcile_next_attempt_at is null or bio.reconcile_next_attempt_at <= now())
    and (bio.reconcile_lease_expires_at is null or bio.reconcile_lease_expires_at <= now())
  order by coalesce(bio.reconcile_next_attempt_at, bio.updated_at), bio.updated_at, bio.object_key
  limit 25
  for update skip locked
), claimed as (
  update business_image_objects bio
  set reconcile_lease_token = '$LEASE_A'::uuid,
      reconcile_lease_expires_at = now() + interval '5 minutes',
      reconcile_attempt_count = bio.reconcile_attempt_count + 1,
      reconcile_last_attempt_at = now(),
      updated_at = now()
  from candidates c
  where bio.object_key = c.object_key
  returning bio.object_key
)
select count(*) from claimed;
SQL
)
if [[ "$CLAIM_A" != "2" ]]; then
  echo "FAIL RECONCILE first claim: expected=2 actual=$CLAIM_A" >&2
  exit 1
fi
echo "PASS RECONCILE first claim pending-only: $CLAIM_A"

assert_scalar "select count(*) from business_image_objects where object_key='$KEY_LEASE_ACTIVE' and reconcile_lease_token is not null" "0" "RECONCILE active row never claimed"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_LEASE_UPLOAD'" "1" "RECONCILE attempt count increments"

# Make rows old again while the lease remains live. A second worker must still
# be excluded by the lease boundary rather than the age threshold alone.
"${PSQL[@]}" -c "update business_image_objects set updated_at=now()-interval '10 minutes' where object_key in ('$KEY_LEASE_UPLOAD','$KEY_LEASE_DELETE')"

CLAIM_B_LIVE=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with candidates as (
  select bio.object_key
  from business_image_objects bio
  where bio.state in ('upload_pending', 'delete_pending')
    and bio.updated_at <= now() - interval '2 minutes'
    and (bio.reconcile_next_attempt_at is null or bio.reconcile_next_attempt_at <= now())
    and (bio.reconcile_lease_expires_at is null or bio.reconcile_lease_expires_at <= now())
  order by coalesce(bio.reconcile_next_attempt_at, bio.updated_at), bio.updated_at, bio.object_key
  limit 25
  for update skip locked
), claimed as (
  update business_image_objects bio
  set reconcile_lease_token = '$LEASE_B'::uuid,
      reconcile_lease_expires_at = now() + interval '5 minutes',
      reconcile_attempt_count = bio.reconcile_attempt_count + 1,
      reconcile_last_attempt_at = now(),
      updated_at = now()
  from candidates c
  where bio.object_key = c.object_key
  returning bio.object_key
)
select count(*) from claimed;
SQL
)
if [[ "$CLAIM_B_LIVE" != "0" ]]; then
  echo "FAIL RECONCILE overlapping live lease: expected=0 actual=$CLAIM_B_LIVE" >&2
  exit 1
fi
echo "PASS RECONCILE overlapping live lease excluded: $CLAIM_B_LIVE"

# Wrong/stale worker token cannot finalize the upload row.
WRONG_FINALIZE=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with finalized as (
  update business_image_objects
  set state='active', reconcile_lease_token=null, reconcile_lease_expires_at=null, updated_at=now()
  where object_key='$KEY_LEASE_UPLOAD'
    and state='upload_pending'
    and reconcile_lease_token='$LEASE_B'::uuid
  returning state
)
select count(*) from finalized;
SQL
)
if [[ "$WRONG_FINALIZE" != "0" ]]; then
  echo "FAIL RECONCILE stale token finalized row" >&2
  exit 1
fi
echo "PASS RECONCILE stale token finalize denied: $WRONG_FINALIZE"
assert_scalar "select state from business_image_objects where object_key='$KEY_LEASE_UPLOAD'" "upload_pending" "RECONCILE stale finalize preserves state"

# Correct lease owner may finalize upload_pending -> active.
"${PSQL[@]}" <<SQL
update business_image_objects
set state='active',
    reconcile_lease_token=null,
    reconcile_lease_expires_at=null,
    reconcile_next_attempt_at=null,
    reconcile_last_error_code=null,
    updated_at=now()
where object_key='$KEY_LEASE_UPLOAD'
  and state='upload_pending'
  and reconcile_lease_token='$LEASE_A'::uuid;
SQL
assert_scalar "select state from business_image_objects where object_key='$KEY_LEASE_UPLOAD'" "active" "RECONCILE correct token activates upload"
assert_scalar "select count(*) from business_image_objects where object_key='$KEY_LEASE_UPLOAD' and reconcile_lease_token is not null" "0" "RECONCILE activation clears lease"

# Expire the delete lease. A later worker must be able to reclaim exactly that
# still-pending row and increment its attempt counter.
"${PSQL[@]}" <<SQL
update business_image_objects
set reconcile_lease_expires_at=now()-interval '1 minute',
    updated_at=now()-interval '10 minutes'
where object_key='$KEY_LEASE_DELETE'
  and reconcile_lease_token='$LEASE_A'::uuid;
SQL

CLAIM_B_EXPIRED=$("${PSQL[@]}" -At <<SQL | tr -d '[:space:]'
with candidates as (
  select bio.object_key
  from business_image_objects bio
  where bio.state in ('upload_pending', 'delete_pending')
    and bio.updated_at <= now() - interval '2 minutes'
    and (bio.reconcile_next_attempt_at is null or bio.reconcile_next_attempt_at <= now())
    and (bio.reconcile_lease_expires_at is null or bio.reconcile_lease_expires_at <= now())
  order by coalesce(bio.reconcile_next_attempt_at, bio.updated_at), bio.updated_at, bio.object_key
  limit 25
  for update skip locked
), claimed as (
  update business_image_objects bio
  set reconcile_lease_token = '$LEASE_B'::uuid,
      reconcile_lease_expires_at = now() + interval '5 minutes',
      reconcile_attempt_count = bio.reconcile_attempt_count + 1,
      reconcile_last_attempt_at = now(),
      updated_at = now()
  from candidates c
  where bio.object_key = c.object_key
  returning bio.object_key
)
select count(*) from claimed;
SQL
)
if [[ "$CLAIM_B_EXPIRED" != "1" ]]; then
  echo "FAIL RECONCILE expired lease reclaim: expected=1 actual=$CLAIM_B_EXPIRED" >&2
  exit 1
fi
echo "PASS RECONCILE expired lease reclaimed: $CLAIM_B_EXPIRED"
assert_scalar "select reconcile_attempt_count from business_image_objects where object_key='$KEY_LEASE_DELETE'" "2" "RECONCILE reclaim increments attempt count"
assert_scalar "select (reconcile_lease_token='$LEASE_B'::uuid)::int from business_image_objects where object_key='$KEY_LEASE_DELETE'" "1" "RECONCILE new lease token owns row"

"${PSQL[@]}" <<SQL
update business_image_objects
set state='retired',
    retired_at=coalesce(retired_at, now()),
    reconcile_lease_token=null,
    reconcile_lease_expires_at=null,
    reconcile_next_attempt_at=null,
    reconcile_last_error_code=null,
    updated_at=now()
where object_key='$KEY_LEASE_DELETE'
  and state='delete_pending'
  and reconcile_lease_token='$LEASE_B'::uuid;
SQL
assert_scalar "select state from business_image_objects where object_key='$KEY_LEASE_DELETE'" "retired" "RECONCILE reclaimed delete retires"

# ---------------------------------------------------------------------------
# Case 1: reference transaction owns registry row first.
# Delete must wait, then its fresh second command must see the committed
# application reference and leave registry state active.
# ---------------------------------------------------------------------------
cleanup_case "$KEY_REF_FIRST"

(
  "${PSQL[@]}" <<SQL
begin;
select object_key from business_image_objects
where object_key = '$KEY_REF_FIRST'
for update;
select pg_sleep(2);
insert into business_applications (
  complex_id, applicant_user_id, relation_type, business_name,
  category_name, service_summary, representative_image_object_key, status
)
select
  '$COMPLEX_ID', '$USER_ID', 'resident', 'Reference First',
  'test', 'reference-first concurrency probe', bio.object_key, 'pending'
from business_image_objects bio
where bio.object_key = '$KEY_REF_FIRST'
  and bio.state = 'active'
  and bio.uploader_user_id = '$USER_ID'
  and bio.complex_id = '$COMPLEX_ID';
commit;
SQL
) &
REF_PID=$!

sleep 0.25

(
  "${PSQL[@]}" <<SQL
begin;
select object_key from business_image_objects
where object_key = '$KEY_REF_FIRST'
for update;
with usage as (
  select
    exists (select 1 from business_media bm where bm.object_key = '$KEY_REF_FIRST') as business_media_in_use,
    exists (
      select 1 from business_applications a
      where a.representative_image_object_key = '$KEY_REF_FIRST'
        and a.status in ('draft', 'pending', 'changes_requested', 'approved')
    ) as application_in_use
)
update business_image_objects bio
set state='delete_pending', delete_requested_at=coalesce(delete_requested_at, now()), updated_at=now()
from usage u
where bio.object_key = '$KEY_REF_FIRST'
  and bio.uploader_user_id = '$USER_ID'
  and bio.state='active'
  and not u.business_media_in_use
  and not u.application_in_use;
commit;
SQL
) &
DELETE_PID=$!

wait "$REF_PID"
wait "$DELETE_PID"

assert_scalar "select state from business_image_objects where object_key='$KEY_REF_FIRST'" "active" "REFERENCE_FIRST registry remains active"
assert_scalar "select count(*) from business_applications where representative_image_object_key='$KEY_REF_FIRST' and status='pending'" "1" "REFERENCE_FIRST reference committed"

# ---------------------------------------------------------------------------
# Case 2: delete-intent transaction owns registry row first.
# Reference transaction waits and, after delete commits delete_pending, its
# conditional insert must observe non-active state and insert zero rows.
# ---------------------------------------------------------------------------
cleanup_case "$KEY_DELETE_FIRST"

(
  "${PSQL[@]}" <<SQL
begin;
select object_key from business_image_objects
where object_key = '$KEY_DELETE_FIRST'
for update;
select pg_sleep(2);
with usage as (
  select
    exists (select 1 from business_media bm where bm.object_key = '$KEY_DELETE_FIRST') as business_media_in_use,
    exists (
      select 1 from business_applications a
      where a.representative_image_object_key = '$KEY_DELETE_FIRST'
        and a.status in ('draft', 'pending', 'changes_requested', 'approved')
    ) as application_in_use
)
update business_image_objects bio
set state='delete_pending', delete_requested_at=coalesce(delete_requested_at, now()), updated_at=now()
from usage u
where bio.object_key = '$KEY_DELETE_FIRST'
  and bio.uploader_user_id = '$USER_ID'
  and bio.state='active'
  and not u.business_media_in_use
  and not u.application_in_use;
commit;
SQL
) &
DELETE_FIRST_PID=$!

sleep 0.25

(
  "${PSQL[@]}" <<SQL
begin;
select object_key from business_image_objects
where object_key = '$KEY_DELETE_FIRST'
for update;
insert into business_applications (
  complex_id, applicant_user_id, relation_type, business_name,
  category_name, service_summary, representative_image_object_key, status
)
select
  '$COMPLEX_ID', '$USER_ID', 'resident', 'Delete First',
  'test', 'delete-first concurrency probe', bio.object_key, 'pending'
from business_image_objects bio
where bio.object_key = '$KEY_DELETE_FIRST'
  and bio.state = 'active'
  and bio.uploader_user_id = '$USER_ID'
  and bio.complex_id = '$COMPLEX_ID';
commit;
SQL
) &
REFERENCE_PID=$!

wait "$DELETE_FIRST_PID"
wait "$REFERENCE_PID"

assert_scalar "select state from business_image_objects where object_key='$KEY_DELETE_FIRST'" "delete_pending" "DELETE_INTENT_FIRST registry becomes delete_pending"
assert_scalar "select count(*) from business_applications where representative_image_object_key='$KEY_DELETE_FIRST'" "0" "DELETE_INTENT_FIRST reference denied"

# Lifecycle constraints must reject incoherent state/timestamps for old and new states.
set +e
"${PSQL[@]}" -c "update business_image_objects set state='retired', retired_at=now() where object_key='$KEY_REF_FIRST'" >/dev/null 2>&1
BAD_LIFECYCLE_STATUS=$?
"${PSQL[@]}" -c "update business_image_objects set state='upload_pending', delete_requested_at=now() where object_key='$KEY_REF_FIRST'" >/dev/null 2>&1
BAD_PENDING_STATUS=$?
"${PSQL[@]}" -c "update business_image_objects set reconcile_lease_token='$LEASE_A'::uuid, reconcile_lease_expires_at=null where object_key='$KEY_REF_FIRST'" >/dev/null 2>&1
BAD_LEASE_PAIR_STATUS=$?
set -e
if [[ "$BAD_LIFECYCLE_STATUS" -eq 0 ]]; then
  echo "FAIL lifecycle timestamp constraint accepted retired without delete_requested_at" >&2
  exit 1
fi
if [[ "$BAD_PENDING_STATUS" -eq 0 ]]; then
  echo "FAIL lifecycle timestamp constraint accepted upload_pending with delete_requested_at" >&2
  exit 1
fi
if [[ "$BAD_LEASE_PAIR_STATUS" -eq 0 ]]; then
  echo "FAIL reconciliation lease constraint accepted token without expiry" >&2
  exit 1
fi
echo "PASS lifecycle/reconciliation constraints reject incoherent timestamps and lease pairs"

echo "PASS PostgreSQL 18 business-image lifecycle + atomicity + reconciliation lease: PENDING_CLAIM; LIVE_LEASE_EXCLUDED; STALE_TOKEN_DENIED; EXPIRED_LEASE_RECLAIMED; REFERENCE_FIRST -> DELETE_DENIED; DELETE_INTENT_FIRST -> REFERENCE_DENIED"
