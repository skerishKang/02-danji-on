#!/usr/bin/env bash
# Issue #844 (CENTRAL review round 3, repair) — REAL PostgreSQL lock-contention
# proof that the official apartment-news photo REFERENCE acquisition and the
# DELETE intent serialize on the same business_image_objects row lock.
#
# What makes this a contention proof (not just execution order):
#   * the winning transaction holds the row lock across a bounded pg_sleep inside
#     its own transaction, so the other transaction is observed BLOCKING;
#   * the blocked transaction's wall-clock elapsed time is asserted to be at least
#     the bounded delay minus a tolerance;
#   * a mutation proof runs the SAME interleave with the protective structure
#     removed (no FOR UPDATE + a check-then-act delete) and asserts that the
#     impossible state (post reference exists AND registry state <> 'active')
#     DOES occur there, so this test bites when the lock is missing.
#
# All sleeps/barriers live in test SQL only. No production source is modified for
# testability; the reference statements below are the production statement shape.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_ID='11111111-1111-4111-8111-111111111111'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
COMPLEX_SLUG='official-news-concurrency-ci'
HOLD_SECONDS=3
BLOCK_MIN_SECONDS=2

KEY_REF_FIRST='gdrive/public/official-news-image/concurrency_ref_first_1234567890'
KEY_DELETE_FIRST='gdrive/public/official-news-image/concurrency_delete_first_1234567890'
KEY_MUTATION='gdrive/public/official-news-image/concurrency_mutation_proof_1234567890'
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

fail_hard() {
  echo "FAIL $1" >&2
  exit 1
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

impossible_state_count() {
  "${PSQL[@]}" -Atc "
    select count(*)
    from complex_posts p
    join business_image_objects b on b.object_key = p.attachment_object_key
    where b.state <> 'active'" | tr -d '[:space:]'
}

# Production statement shape (official-news-attachment-v1): lock the registry row,
# re-check kind/state/complex, then insert the post reference from that locked row.
reference_sql() {
  local key="$1"
  local hold="${2:-0}"
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
$(if [[ "$hold" != "0" ]]; then echo "select pg_sleep($hold);"; fi)
commit;
SQL
}

# The UNPROTECTED reference variant: no FOR UPDATE, no atomic re-check. Used only by
# the mutation proof to show the test detects the state the lock exists to prevent.
reference_sql_unlocked() {
  local key="$1"
  cat <<SQL
begin;
insert into complex_posts (
  complex_id, author_user_id, source_name, category, title, body,
  attachment_object_key, status, published_at, channel
)
select
  '$COMPLEX_ID', '$USER_ID', '단지온 운영자', '회의결과', '동시성 검증', '본문',
  b.object_key, 'published', now(), 'apartment_news'
from business_image_objects b
where b.object_key = '$key'
  and b.kind = 'official-news-image'
  and b.state = 'active'
  and b.complex_id = '$COMPLEX_ID';
commit;
SQL
}

# Production statement shape (storage-v1 delete intent): lock the registry row, then move
# active -> delete_pending only when no post references the object.
delete_intent_sql() {
  local key="$1"
  local hold="${2:-0}"
  cat <<SQL
begin;
select object_key from business_image_objects
where object_key = '$key' and kind = 'official-news-image'
for update;
$(if [[ "$hold" != "0" ]]; then echo "select pg_sleep($hold);"; fi)
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

# The UNPROTECTED delete variant: no FOR UPDATE and the reference check happens in a
# SEPARATE statement before the update (check-then-act). Mutation proof only.
delete_intent_sql_unlocked() {
  local key="$1"
  local hold="${2:-0}"
  cat <<SQL
begin;
select exists (
  select 1 from complex_posts p where p.attachment_object_key = '$key'
) as post_in_use;
$(if [[ "$hold" != "0" ]]; then echo "select pg_sleep($hold);"; fi)
update business_image_objects
set state='delete_pending', delete_requested_at=coalesce(delete_requested_at, now()), updated_at=now()
where object_key = '$key'
  and kind = 'official-news-image'
  and state = 'active';
commit;
SQL
}

run_timed() {
  # run_timed <outfile> <sql-file> -> echoes elapsed seconds
  local outfile="$1"
  local sqlfile="$2"
  local start end
  start=$(date +%s)
  "${PSQL[@]}" < "$sqlfile" > "$outfile"
  end=$(date +%s)
  echo $((end - start))
}

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# ---------------------------------------------------------------------------
# Case 1: REFERENCE_WINS under true contention.
# TX A holds the registry row lock across a bounded sleep. TX B (delete intent)
# starts inside that window and must BLOCK until A commits; afterwards B must
# observe the committed reference and refuse the delete intent.
# ---------------------------------------------------------------------------
reset_active "$KEY_REF_FIRST"
reference_sql "$KEY_REF_FIRST" "$HOLD_SECONDS" > "$TMP_DIR/ref_first.sql"
delete_intent_sql "$KEY_REF_FIRST" 0 > "$TMP_DIR/del_second.sql"

{ "${PSQL[@]}" < "$TMP_DIR/ref_first.sql"; } &
REF_PID=$!
sleep 0.25
DEL_ELAPSED=$(run_timed "$TMP_DIR/del_out.txt" "$TMP_DIR/del_second.sql")
wait "$REF_PID"

if [[ "$DEL_ELAPSED" -lt "$BLOCK_MIN_SECONDS" ]]; then
  fail_hard "REFERENCE_WINS delete intent did not block on the row lock (elapsed=${DEL_ELAPSED}s < ${BLOCK_MIN_SECONDS}s)"
fi
echo "PASS REFERENCE_WINS delete intent blocked on the held lock: ${DEL_ELAPSED}s"
assert_scalar "select state from business_image_objects where object_key='$KEY_REF_FIRST'" "active" "REFERENCE_WINS registry remains active"
assert_scalar "select count(*) from complex_posts where attachment_object_key='$KEY_REF_FIRST'" "1" "REFERENCE_WINS reference committed"
assert_scalar "select count(*) from complex_posts p join business_image_objects b on b.object_key=p.attachment_object_key where b.state <> 'active'" "0" "REFERENCE_WINS no impossible state"

# ---------------------------------------------------------------------------
# Case 2: DELETE_WINS under true contention.
# TX D holds the row lock across a bounded sleep before moving active ->
# delete_pending. TX R (reference, production shape) starts inside that window,
# must BLOCK, and after the lock releases must re-evaluate non-active state and
# insert ZERO rows.
# ---------------------------------------------------------------------------
reset_active "$KEY_DELETE_FIRST"
delete_intent_sql "$KEY_DELETE_FIRST" "$HOLD_SECONDS" > "$TMP_DIR/del_first.sql"
reference_sql "$KEY_DELETE_FIRST" 0 > "$TMP_DIR/ref_second.sql"

{ "${PSQL[@]}" < "$TMP_DIR/del_first.sql"; } &
DEL_FIRST_PID=$!
sleep 0.25
REF_ELAPSED=$(run_timed "$TMP_DIR/ref_out.txt" "$TMP_DIR/ref_second.sql")
wait "$DEL_FIRST_PID"

if [[ "$REF_ELAPSED" -lt "$BLOCK_MIN_SECONDS" ]]; then
  fail_hard "DELETE_WINS reference write did not block on the row lock (elapsed=${REF_ELAPSED}s < ${BLOCK_MIN_SECONDS}s)"
fi
echo "PASS DELETE_WINS reference write blocked on the held lock: ${REF_ELAPSED}s"
assert_scalar "select state from business_image_objects where object_key='$KEY_DELETE_FIRST'" "delete_pending" "DELETE_WINS registry becomes delete_pending"
assert_scalar "select count(*) from complex_posts where attachment_object_key='$KEY_DELETE_FIRST'" "0" "DELETE_WINS reference denied"
assert_scalar "select count(*) from complex_posts p join business_image_objects b on b.object_key=p.attachment_object_key where b.state <> 'active'" "0" "DELETE_WINS no impossible state"

# ---------------------------------------------------------------------------
# Case 3: MUTATION PROOF — the test must bite when FOR UPDATE is absent.
# The same interleave is run with the unprotected shapes: the reference inserts
# without locking and the delete checks references before a separate update.
# The impossible state (reference exists AND registry state <> 'active') MUST
# appear here, which is exactly what the protected shapes above prevent.
# ---------------------------------------------------------------------------
reset_active "$KEY_MUTATION"
delete_intent_sql_unlocked "$KEY_MUTATION" "$HOLD_SECONDS" > "$TMP_DIR/mut_del.sql"
reference_sql_unlocked "$KEY_MUTATION" > "$TMP_DIR/mut_ref.sql"

{ "${PSQL[@]}" < "$TMP_DIR/mut_del.sql"; } &
MUT_DEL_PID=$!
sleep 0.25
"${PSQL[@]}" < "$TMP_DIR/mut_ref.sql"
wait "$MUT_DEL_PID"

MUTATION_IMPOSSIBLE=$(impossible_state_count)
if [[ "$MUTATION_IMPOSSIBLE" -lt 1 ]]; then
  fail_hard "MUTATION_PROOF did not bite: expected the impossible state without FOR UPDATE, found 0"
fi
echo "PASS MUTATION_PROOF impossible state detected without FOR UPDATE: $MUTATION_IMPOSSIBLE"
assert_scalar "select state from business_image_objects where object_key='$KEY_MUTATION'" "delete_pending" "MUTATION_PROOF registry moved to delete_pending"
assert_scalar "select count(*) from complex_posts where attachment_object_key='$KEY_MUTATION'" "1" "MUTATION_PROOF stale reference committed"

# ---------------------------------------------------------------------------
# Case 4: IMPOSSIBLE_REFERENCE_PLUS_NONACTIVE_STATE by construction.
# A non-active registry row can never be attached even without concurrency.
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
  "${PSQL[@]}" < <(reference_sql "$key")
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
  fail_hard "namespace guard accepted an official-news kind with a business-image namespace"
fi
if [[ "$BAD_KIND_STATUS" -eq 0 ]]; then
  fail_hard "kind guard accepted an unknown storage kind"
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
  fail_hard "official-news idempotency lane accepted a duplicate (uploader, key)"
fi
echo "PASS official-news idempotency lane rejects a duplicate (uploader, key)"

echo "PASS PostgreSQL official-news image lock-contention proof: REFERENCE_WINS(blocked); DELETE_WINS(blocked); MUTATION_PROOF(bites without FOR UPDATE); IMPOSSIBLE_REFERENCE_PLUS_NONACTIVE_STATE; KIND_NAMESPACE_GUARDS; IDEMPOTENCY_LANE"
