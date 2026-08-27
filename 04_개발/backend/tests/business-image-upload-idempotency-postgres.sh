#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_A='11111111-1111-4111-8111-111111111111'
USER_B='33333333-3333-4333-8333-333333333333'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
FP_A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
FP_B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
IDEM_KEY='retry-upload-key-0001'
RACE_KEY='retry-race-key-0001'
OBJECT_A='gdrive/public/business-image/idempotency_a_1234567890'
OBJECT_B='gdrive/public/business-image/idempotency_b_1234567890'
OBJECT_C='gdrive/public/business-image/idempotency_c_1234567890'
RACE_A='gdrive/public/business-image/idempotency_race_a_1234567890'
RACE_B='gdrive/public/business-image/idempotency_race_b_1234567890'

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
insert into app_users (id, auth_user_id, display_name) values
  ('$USER_A', 'idempotency-user-a', 'Idempotency A'),
  ('$USER_B', 'idempotency-user-b', 'Idempotency B');
insert into complexes (id, slug, name)
values ('$COMPLEX_ID', 'idempotency-complex', 'Idempotency Complex');
SQL

"${PSQL[@]}" -f migrations/019_business_image_lifecycle_registry.sql
"${PSQL[@]}" -f migrations/020_business_image_upload_pending.sql
"${PSQL[@]}" -f migrations/021_business_image_reconciliation_lease.sql
"${PSQL[@]}" -f migrations/022_business_image_upload_idempotency.sql

# One uploader/key pair binds to one durable object key.
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$OBJECT_A', '$USER_A', '$COMPLEX_ID', 'upload_pending', '$IDEM_KEY', '$FP_A'
);
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$OBJECT_B', '$USER_A', '$COMPLEX_ID', 'upload_pending', '$IDEM_KEY', '$FP_B'
) on conflict do nothing;
SQL
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY'" "1" "IDEMPOTENCY same uploader/key has one winner"
assert_scalar "select (object_key='$OBJECT_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY'" "1" "IDEMPOTENCY first durable object remains winner"
assert_scalar "select (upload_request_fingerprint='$FP_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY'" "1" "IDEMPOTENCY winner fingerprint is immutable by loser"

# Key namespace is per uploader, not global.
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$OBJECT_C', '$USER_B', '$COMPLEX_ID', 'upload_pending', '$IDEM_KEY', '$FP_A'
);
SQL
assert_scalar "select count(*) from business_image_objects where upload_idempotency_key='$IDEM_KEY'" "2" "IDEMPOTENCY same key allowed for different uploader"

# No-key callers remain backward-compatible and are outside the partial unique index.
"${PSQL[@]}" <<SQL
insert into business_image_objects (object_key, uploader_user_id, complex_id, state)
values
  ('gdrive/public/business-image/no_key_a_1234567890', '$USER_A', '$COMPLEX_ID', 'upload_pending'),
  ('gdrive/public/business-image/no_key_b_1234567890', '$USER_A', '$COMPLEX_ID', 'upload_pending');
SQL
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key is null" "2" "IDEMPOTENCY no-key compatibility preserved"

# Real concurrent same-key claims serialize on the partial unique index.
(
  "${PSQL[@]}" <<SQL
begin;
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$RACE_A', '$USER_A', '$COMPLEX_ID', 'upload_pending', '$RACE_KEY', '$FP_A'
) on conflict do nothing;
select pg_sleep(2);
commit;
SQL
) &
RACE_A_PID=$!

sleep 0.25

(
  "${PSQL[@]}" <<SQL
begin;
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$RACE_B', '$USER_A', '$COMPLEX_ID', 'upload_pending', '$RACE_KEY', '$FP_A'
) on conflict do nothing;
commit;
SQL
) &
RACE_B_PID=$!

wait "$RACE_A_PID"
wait "$RACE_B_PID"

assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$RACE_KEY'" "1" "IDEMPOTENCY concurrent same-key reservation has one durable winner"
assert_scalar "select (object_key='$RACE_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$RACE_KEY'" "1" "IDEMPOTENCY concurrent loser cannot replace winner object"

# Pair, key format and fingerprint constraints fail closed.
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key,uploader_user_id,complex_id,state,upload_idempotency_key) values ('gdrive/public/business-image/bad_pair_1234567890','$USER_A','$COMPLEX_ID','upload_pending','valid-key-0001')" >/dev/null 2>&1
BAD_PAIR=$?
"${PSQL[@]}" -c "insert into business_image_objects (object_key,uploader_user_id,complex_id,state,upload_idempotency_key,upload_request_fingerprint) values ('gdrive/public/business-image/bad_key_1234567890','$USER_A','$COMPLEX_ID','upload_pending','bad key','$FP_A')" >/dev/null 2>&1
BAD_KEY=$?
"${PSQL[@]}" -c "insert into business_image_objects (object_key,uploader_user_id,complex_id,state,upload_idempotency_key,upload_request_fingerprint) values ('gdrive/public/business-image/bad_fp_1234567890','$USER_A','$COMPLEX_ID','upload_pending','valid-key-0002','not-a-sha256')" >/dev/null 2>&1
BAD_FP=$?
set -e

if [[ "$BAD_PAIR" -eq 0 ]]; then
  echo "FAIL IDEMPOTENCY pair constraint accepted key without fingerprint" >&2
  exit 1
fi
if [[ "$BAD_KEY" -eq 0 ]]; then
  echo "FAIL IDEMPOTENCY key format constraint accepted invalid key" >&2
  exit 1
fi
if [[ "$BAD_FP" -eq 0 ]]; then
  echo "FAIL IDEMPOTENCY fingerprint constraint accepted invalid digest" >&2
  exit 1
fi

echo "PASS IDEMPOTENCY pair/key/fingerprint constraints reject invalid rows"
echo "PASS PostgreSQL 18 business-image upload idempotency: UNIQUE_PER_UPLOADER_KEY; CONCURRENT_ONE_WINNER; LOSER_CANNOT_REPLACE; NO_KEY_COMPATIBLE; CONSTRAINTS_FAIL_CLOSED"
