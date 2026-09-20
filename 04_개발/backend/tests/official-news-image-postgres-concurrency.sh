#!/usr/bin/env bash
# Issue #844 (CENTRAL review round 3, BLOCKER C) — real PostgreSQL interleave
# between the official apartment-news photo REFERENCE acquisition and the
# DELETE intent. Both paths must serialize on the same
# business_image_objects row lock, so exactly one of them can win.
#
# REFERENCE_WINS            : the post reference commits -> the delete intent sees the
#                             reference and must leave the row active.
# DELETE_WINS               : the delete intent commits delete_pending -> the reference
#                             write must insert ZERO rows.
# IMPOSSIBLE_REFERENCE_PLUS_NONACTIVE_STATE
#                           : a non-active registry row can never be attached, even when
#                             the preliminary validator is bypassed entirely.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_ID='11111111-1111-4111-8111-111111111111'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
COMPLEX_SLUG='official-news-concurrency-ci'
KEY_REF_FIRST='gdrive/public/official-news-image/concurrency_ref_first_1234567890'
KEY_DELETE_FIRST='gdrive/public/official-news-image/concurrency_delete_first_1234567890'
KEY_NON_ACTIVE='gdrive/public/official-news-image/concurrency_non_active_1234567890'
KEY_UPLOAD_PENDING='gdrive/public/official-news-image/concurrency_upload_pending_1234567890'

# Minimal prerequisite product schema. Migration 057 (the DDL under test for the
# new kind/namespace/lifecycle lane) is applied from the repository file below.
"${PSQL[@]}" <<SQL
create extension if not exists pgcrypto;
drop table if exists complex_posts cascade;
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
create table business_image_objects (
  object_key text primary key,
  uploader_user_id uuid not null references app_users(id),
  complex_id uuid not null references complexes(id),
  state text not null default 'active'
    check (state in ('upload_pending', 'active', 'delete_pending', 'retired')),
  kind text not null default 'business-image',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delete_requested_at timestamptz,
  retired_at timestamptz,
  upload_idempotency_key text,
  upload_request_fingerprint text,
  reconcile_lease_token uuid,
  reconcile_lease_expires_at timestamptz,
  reconcile_attempt_count integer not null default 0,
  reconcile_next_attempt_at timestamptz,
  reconcile_last_error_code text,
  reconcile_last_attempt_at timestamptz,
  constraint chk_business_image_object_lifecycle_timestamps
    check (
      (state = 'upload_pending' and delete_requested_at is null and retired_at is null)
      or (state = 'active' and delete_requested_at is null and retired_at is null)
      or (state = 'delete_pending' and delete_requested_at is not null and retired_at is null)
      or (state = 'retired' and delete_requested_at is not null and retired_at is not null)
    )
);
create table complex_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id),
  author_user_id uuid not null references app_users(id),
  source_name text not null,
  category text not null,
  title text not null,
  body text not null,
  attachment_object_key text,
  status text not null default 'published',
  published_at timestamptz,
  channel text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into app_users (id, auth_user_id, display_name)
values ('$USER_ID', 'official-news-ci-user', 'Official News CI');
insert into complexes (id, slug, name)
values ('$COMPLEX_ID', '$COMPLEX_SLUG', 'Official News CI Complex');
SQL

"${PSQL[@]}" -f migrations/057_official_news_image_storage.sql

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

reset_active() {
  local key="$1"
  "${PSQL[@]}" <<SQL
  delete from complex_posts where attachment_object_key = '$key';
  delete from business_image_objects where object_key = '$key';
  insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind)
  values ('$key', '$USER_ID', '$COMPLEX_ID', 'active', 'official-news-image');
SQL
}

# The reference write under test: lock the registry row, re-check active/kind/complex,
# then insert the post reference from that locked row.
REFERENCE_SQL() {
  local key="$1"
  cat <<SQL
begin;
with locked as (
  select object_key
  from business_image_objects
  where object_key = '$key'
    and kind = 'official-news-image'
    and state = 'active'
    and complex_id = '$COMPLEX_ID'
  for update
)
insert into complex_posts (
  complex_id, author_user_id, source_name, category, title, body,
  attachment_object_key, status, published_at, channel
)
select
  '$COMPLEX_ID', '$USER_ID', '단지온 운영자', '회의결과', '동시성 검증', '본문',
  locked.object_key, 'published', now(), 'apartment_news'
from locked;
commit;
SQL
}

# The delete intent under test: lock the registry row, then move active -> delete_pending
# only when no post references the object.
DELETE_INTENT_SQL() {
  local key="$1"
  cat <<SQL
begin;
select object_key from business_image_objects
where object_key = '$key' and kind = 'official-news-image'
for update;
with usage as (
  select exists (
    select 1 from complex_posts p where p.attachment_object_key = '$key'
  ) as post_in_use
)
update business_image_objects bio
set state='delete_pending', delete_requested_at=coalesce(delete_requested_at, now()), updated_at=now()
from usage u
where bio.object_key = '$key'
  and bio.kind = 'official-news-image'
  and bio.state = 'active'
  and not u.post_in_use;
commit;
SQL
}

# ---------------------------------------------------------------------------
# Case 1: REFERENCE_WINS
# ---------------------------------------------------------------------------
reset_active "$KEY_REF_FIRST"

{ "${PSQL[@]}" < <(REFERENCE_SQL "$KEY_REF_FIRST"); } &
REF_PID=$!
sleep 0.25
{ "${PSQL[@]}" < <(DELETE_INTENT_SQL "$KEY_REF_FIRST"); } &
DELETE_PID=$!
wait "$REF_PID"
wait "$DELETE_PID"

assert_scalar "select state from business_image_objects where object_key='$KEY_REF_FIRST'" "active" "REFERENCE_WINS registry remains active"
assert_scalar "select count(*) from complex_posts where attachment_object_key='$KEY_REF_FIRST'" "1" "REFERENCE_WINS reference committed"

# ---------------------------------------------------------------------------
# Case 2: DELETE_WINS
# ---------------------------------------------------------------------------
reset_active "$KEY_DELETE_FIRST"

{ "${PSQL[@]}" < <(DELETE_INTENT_SQL "$KEY_DELETE_FIRST"); } &
DELETE_FIRST_PID=$!
sleep 0.25
{ "${PSQL[@]}" < <(REFERENCE_SQL "$KEY_DELETE_FIRST"); } &
REFERENCE_PID=$!
wait "$DELETE_FIRST_PID"
wait "$REFERENCE_PID"

assert_scalar "select state from business_image_objects where object_key='$KEY_DELETE_FIRST'" "delete_pending" "DELETE_WINS registry becomes delete_pending"
assert_scalar "select count(*) from complex_posts where attachment_object_key='$KEY_DELETE_FIRST'" "0" "DELETE_WINS reference denied"

# ---------------------------------------------------------------------------
# Case 3: IMPOSSIBLE_REFERENCE_PLUS_NONACTIVE_STATE
# A non-active row can never be attached even without the preliminary validator.
# ---------------------------------------------------------------------------
for state in delete_pending upload_pending; do
  if [[ "$state" == "delete_pending" ]]; then
    key="$KEY_NON_ACTIVE"
    delete_ts='now()'
  else
    key="$KEY_UPLOAD_PENDING"
    delete_ts='null'
  fi
  "${PSQL[@]}" <<SQL
  delete from complex_posts where attachment_object_key = '$key';
  delete from business_image_objects where object_key = '$key';
  insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, delete_requested_at)
  values ('$key', '$USER_ID', '$COMPLEX_ID', '$state', 'official-news-image', $delete_ts);
SQL
  "${PSQL[@]}" < <(REFERENCE_SQL "$key")
  assert_scalar "select count(*) from complex_posts where attachment_object_key='$key'" "0" "NON_ACTIVE_STATE($state) reference denied"
  assert_scalar "select state from business_image_objects where object_key='$key'" "$state" "NON_ACTIVE_STATE($state) registry unchanged"
done

# The namespace guard must reject a mismatched kind/namespace pair outright.
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind) values ('gdrive/public/business-image/namespace_violation_1234567890', '$USER_ID', '$COMPLEX_ID', 'active', 'official-news-image')" >/dev/null 2>&1
BAD_NAMESPACE_STATUS=$?
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind) values ('gdrive/public/official-news-image/unknown_kind_1234567890', '$USER_ID', '$COMPLEX_ID', 'active', 'unknown-kind')" >/dev/null 2>&1
BAD_KIND_STATUS=$?
set -e

if [[ "$BAD_NAMESPACE_STATUS" -eq 0 ]]; then
  echo "FAIL namespace guard accepted an official-news kind with a business-image namespace" >&2
  exit 1
fi
if [[ "$BAD_KIND_STATUS" -eq 0 ]]; then
  echo "FAIL kind guard accepted an unknown storage kind" >&2
  exit 1
fi
echo "PASS kind/namespace guards reject mismatched pairs"

# Upload idempotency lane is kind-scoped: the same Idempotency-Key must be reusable
# across kinds without colliding, and unique within the official-news kind.
"${PSQL[@]}" <<SQL
delete from business_image_objects where object_key in (
  'gdrive/public/official-news-image/idem_lane_1234567890',
  'gdrive/public/business-image/idem_lane_1234567890'
);
insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint)
values ('gdrive/public/official-news-image/idem_lane_1234567890', '$USER_ID', '$COMPLEX_ID', 'upload_pending', 'official-news-image', 'shared-idem-key-001', repeat('a', 64));
insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint)
values ('gdrive/public/business-image/idem_lane_1234567890', '$USER_ID', '$COMPLEX_ID', 'upload_pending', 'business-image', 'shared-idem-key-001', repeat('b', 64));
SQL
assert_scalar "select count(*) from business_image_objects where upload_idempotency_key='shared-idem-key-001'" "2" "IDEMPOTENCY_LANE kind-scoped across kinds"

set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint) values ('gdrive/public/official-news-image/idem_dup_1234567890', '$USER_ID', '$COMPLEX_ID', 'upload_pending', 'official-news-image', 'shared-idem-key-001', repeat('c', 64))" >/dev/null 2>&1
DUP_IDEM_STATUS=$?
set -e
if [[ "$DUP_IDEM_STATUS" -eq 0 ]]; then
  echo "FAIL official-news idempotency lane accepted a duplicate (uploader, key)" >&2
  exit 1
fi
echo "PASS official-news idempotency lane rejects a duplicate (uploader, key)"

echo "PASS PostgreSQL official-news image reference/delete serialization: REFERENCE_WINS; DELETE_WINS; IMPOSSIBLE_REFERENCE_PLUS_NONACTIVE_STATE; KIND_NAMESPACE_GUARDS; IDEMPOTENCY_LANE"
