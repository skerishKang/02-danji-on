#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_ID='11111111-1111-4111-8111-111111111111'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
KEY_REF_FIRST='gdrive/public/business-image/concurrency_ref_first_1234567890'
KEY_DELETE_FIRST='gdrive/public/business-image/concurrency_delete_first_1234567890'

# Minimal prerequisite product schema. Migration 019 itself is applied from the
# repository file below, so the lifecycle DDL under test is not duplicated here.
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

# Lifecycle constraints must also reject incoherent state/timestamps.
set +e
"${PSQL[@]}" -c "update business_image_objects set state='retired', retired_at=now() where object_key='$KEY_REF_FIRST'" >/dev/null 2>&1
BAD_LIFECYCLE_STATUS=$?
set -e
if [[ "$BAD_LIFECYCLE_STATUS" -eq 0 ]]; then
  echo "FAIL lifecycle timestamp constraint accepted retired without delete_requested_at" >&2
  exit 1
fi
echo "PASS lifecycle timestamp constraint rejects incoherent retirement"

echo "PASS PostgreSQL 18 business-image atomicity concurrency: REFERENCE_FIRST -> DELETE_DENIED; DELETE_INTENT_FIRST -> REFERENCE_DENIED"
