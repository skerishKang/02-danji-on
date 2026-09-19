#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -q)

USER_A='11111111-1111-4111-8111-111111111111'
USER_B='33333333-3333-4333-8333-333333333333'
COMPLEX_ID='22222222-2222-4222-8222-222222222222'
FP_A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
FP_B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
IDEM_KEY='retry-app-doc-key-0001'
RACE_KEY='retry-app-doc-race-key-0001'
DOC_A='gdrive/private/application-document/doc_a_1234567890'
DOC_B='gdrive/private/application-document/doc_b_1234567890'
DOC_C='gdrive/private/application-document/doc_c_1234567890'
RACE_A='gdrive/private/application-document/doc_race_a_1234567890'
RACE_B='gdrive/private/application-document/doc_race_b_1234567890'
BIZ_IMG_A='gdrive/public/business-image/biz_a_1234567890'
BIZ_IMG_B='gdrive/public/business-image/biz_b_1234567890'

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

# 1. Base tables setup
"${PSQL[@]}" <<SQL
create extension if not exists pgcrypto;
drop table if exists business_application_documents cascade;
drop table if exists business_image_objects cascade;
drop table if exists business_applications cascade;
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
  id uuid primary key,
  complex_id uuid not null references complexes(id),
  applicant_user_id uuid not null references app_users(id)
);
insert into app_users (id, auth_user_id, display_name) values
  ('$USER_A', 'idempotency-app-doc-user-a', 'Doc Idempotency A'),
  ('$USER_B', 'idempotency-app-doc-user-b', 'Doc Idempotency B');
insert into complexes (id, slug, name)
values ('$COMPLEX_ID', 'idempotency-app-doc-complex', 'Doc Idempotency Complex');
SQL

# 1. Migration chain: 019 -> 020 -> 021 -> 022 -> 045 -> 054
"${PSQL[@]}" -f migrations/019_business_image_lifecycle_registry.sql
"${PSQL[@]}" -f migrations/020_business_image_upload_pending.sql
"${PSQL[@]}" -f migrations/021_business_image_reconciliation_lease.sql
"${PSQL[@]}" -f migrations/022_business_image_upload_idempotency.sql
"${PSQL[@]}" -f migrations/045_application_documents.sql
"${PSQL[@]}" -f migrations/054_application_document_upload_idempotency.sql

echo "PASS 1. Migrations 019 -> 020 -> 021 -> 022 -> 045 -> 054 applied cleanly"

# 2. Private application-document namespace insert succeeds
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$DOC_A', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document',
  '$IDEM_KEY', '$FP_A'
);
SQL
assert_scalar "select count(*) from business_image_objects where object_key='$DOC_A' and kind='application-document'" "1" "2. Private application-document namespace insert succeeded"

# Namespace guard rejection check for application-document with wrong prefix
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind) values ('gdrive/public/application-document/invalid_prefix', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document')" >/dev/null 2>&1
BAD_APP_DOC_PREFIX=$?
set -e
if [[ "$BAD_APP_DOC_PREFIX" -eq 0 ]]; then
  echo "FAIL Namespace check allowed public prefix for application-document" >&2
  exit 1
fi
echo "PASS 2. Invalid application-document namespace prefix rejected"

# 3. Business-image namespace remains normal
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind
) values (
  '$BIZ_IMG_A', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'business-image'
);
SQL
assert_scalar "select count(*) from business_image_objects where object_key='$BIZ_IMG_A' and kind='business-image'" "1" "3. Business-image namespace remains normal"

# Namespace guard rejection check for business-image with private prefix
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind) values ('gdrive/private/business-image/invalid_prefix', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'business-image')" >/dev/null 2>&1
BAD_BIZ_PREFIX=$?
set -e
if [[ "$BAD_BIZ_PREFIX" -eq 0 ]]; then
  echo "FAIL Namespace check allowed private prefix for business-image" >&2
  exit 1
fi
echo "PASS 3. Invalid business-image namespace prefix rejected"

# 4. Application-document same uploader + same key = one durable winner
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$DOC_B', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document',
  '$IDEM_KEY', '$FP_B'
) on conflict do nothing;
SQL
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY' and kind='application-document'" "1" "4. Application-document same uploader/key has one durable winner"
assert_scalar "select (object_key='$DOC_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY' and kind='application-document'" "1" "4. First durable object remains winner"
assert_scalar "select (upload_request_fingerprint='$FP_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY' and kind='application-document'" "1" "4. Winner fingerprint is immutable by loser"

# 5 & 6. Concurrent same-key insert = exactly one winner; loser cannot replace winner object
(
  "${PSQL[@]}" <<SQL
begin;
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$RACE_A', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document',
  '$RACE_KEY', '$FP_A'
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
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$RACE_B', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document',
  '$RACE_KEY', '$FP_A'
) on conflict do nothing;
commit;
SQL
) &
RACE_B_PID=$!

wait "$RACE_A_PID"
wait "$RACE_B_PID"

assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$RACE_KEY' and kind='application-document'" "1" "5. Concurrent same-key reservation has exactly one durable winner"
assert_scalar "select (object_key='$RACE_A')::int from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$RACE_KEY' and kind='application-document'" "1" "6. Concurrent loser cannot replace winner object"

# 7. Same key + different uploader is allowed
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$DOC_C', '$USER_B', '$COMPLEX_ID', 'upload_pending', 'application-document',
  '$IDEM_KEY', '$FP_A'
);
SQL
assert_scalar "select count(*) from business_image_objects where upload_idempotency_key='$IDEM_KEY' and kind='application-document'" "2" "7. Same key allowed for different uploader"

# 8. Business-image and application-document can use the same uploader/key independently
"${PSQL[@]}" <<SQL
insert into business_image_objects (
  object_key, uploader_user_id, complex_id, state, kind,
  upload_idempotency_key, upload_request_fingerprint
) values (
  '$BIZ_IMG_B', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'business-image',
  '$IDEM_KEY', '$FP_A'
);
SQL
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY'" "2" "8. Business-image and application-document coexist with same uploader/key"
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY' and kind='application-document'" "1" "8. Application-document lane isolated"
assert_scalar "select count(*) from business_image_objects where uploader_user_id='$USER_A' and upload_idempotency_key='$IDEM_KEY' and kind='business-image'" "1" "8. Business-image lane isolated"

# Duplicate key within business-image lane for same uploader must conflict
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint) values ('gdrive/public/business-image/biz_dup_123', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'business-image', '$IDEM_KEY', '$FP_B')" >/dev/null 2>&1
BIZ_DUP_STATUS=$?
set -e
if [[ "$BIZ_DUP_STATUS" -eq 0 ]]; then
  echo "FAIL Business-image duplicate idempotency key was accepted without conflict" >&2
  exit 1
fi
echo "PASS 8. Duplicate business-image idempotency key correctly conflicted"

# 9. Invalid key/fingerprint pair constraint fail closed
set +e
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key) values ('gdrive/private/application-document/bad_pair_1', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document', 'valid-key-0001')" >/dev/null 2>&1
BAD_PAIR=$?
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint) values ('gdrive/private/application-document/bad_key_1', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document', 'bad key', '$FP_A')" >/dev/null 2>&1
BAD_KEY=$?
"${PSQL[@]}" -c "insert into business_image_objects (object_key, uploader_user_id, complex_id, state, kind, upload_idempotency_key, upload_request_fingerprint) values ('gdrive/private/application-document/bad_fp_1', '$USER_A', '$COMPLEX_ID', 'upload_pending', 'application-document', 'valid-key-0002', 'not-a-sha256')" >/dev/null 2>&1
BAD_FP=$?
set -e

if [[ "$BAD_PAIR" -eq 0 ]]; then
  echo "FAIL 9. Pair constraint accepted key without fingerprint" >&2
  exit 1
fi
if [[ "$BAD_KEY" -eq 0 ]]; then
  echo "FAIL 9. Key format constraint accepted invalid key" >&2
  exit 1
fi
if [[ "$BAD_FP" -eq 0 ]]; then
  echo "FAIL 9. Fingerprint constraint accepted invalid digest" >&2
  exit 1
fi
echo "PASS 9. Pair/key/fingerprint constraints reject invalid rows fail-closed"

# 10. Application-document upload_pending -> active state transition is normal per schema constraints
"${PSQL[@]}" <<SQL
update business_image_objects
set state = 'active',
    updated_at = now()
where object_key = '$DOC_A'
  and uploader_user_id = '$USER_A'
  and complex_id = '$COMPLEX_ID'
  and kind = 'application-document'
  and state = 'upload_pending';
SQL
assert_scalar "select state from business_image_objects where object_key='$DOC_A'" "active" "10. Application-document upload_pending -> active transition succeeds"

# Invalid state transition fails closed per chk_business_image_object_state
set +e
"${PSQL[@]}" -c "update business_image_objects set state = 'invalid_state' where object_key='$DOC_A'" >/dev/null 2>&1
BAD_STATE=$?
set -e
if [[ "$BAD_STATE" -eq 0 ]]; then
  echo "FAIL 10. Object state check constraint accepted invalid state" >&2
  exit 1
fi
echo "PASS 10. Application-document upload_pending -> active state normal and guarded by schema constraints"

echo "PASS PostgreSQL 18 application-document upload idempotency: ALL 10 PROOFS VERIFIED"
