#!/usr/bin/env bash
# GAP-4: migration 044 PostgreSQL lifecycle.
# Proves 044 applies against real PostgreSQL: first apply, rerun idempotency,
# 0..3 gallery enforcement, uniqueness, namespace check, FK cascade, and the
# representative-column preservation. Requires DATABASE_URL pointing at a
# NON-PRODUCTION scratch database. Never run against production.
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

# ------------------------------------------------------------------ 1. apply
"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/044_application_photos.sql
echo "PASS 044 first apply exits 0"
"${psql_cmd[@]}" -f migrations/044_application_photos.sql
echo "PASS 044 rerun is idempotent"

expect_scalar 'gallery table exists' \
  'business_application_photos' \
  "select table_name from information_schema.tables where table_name = 'business_application_photos'"

expect_scalar 'representative column preserved' \
  'representative_image_object_key' \
  "select column_name from information_schema.columns where table_name = 'business_applications' and column_name = 'representative_image_object_key'"

# ------------------------------------------------------------------ 2. seed
"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'gap4-complex', 'GAP4 Complex')
on conflict (id) do nothing;
insert into app_users (id, auth_user_id, display_name) values
  ('22222222-2222-4222-8222-222222222222', 'gap4-user', 'GAP4 User')
on conflict (id) do nothing;
insert into business_applications
  (id, complex_id, applicant_user_id, relation_type, business_name, category_name, service_summary, representative_image_object_key, status)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'resident', 'GAP4 Shop', 'food', 'summary',
   'gdrive/public/business-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pending')
on conflict (id) do nothing;
SQL
echo "PASS seed base rows"

# ------------------------------------------------------- 3. 0..3 accepted
"${psql_cmd[@]}" <<'SQL'
delete from business_application_photos where application_id = '33333333-3333-4333-8333-333333333333';
insert into business_application_photos (application_id, object_key, sort_order) values
  ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0),
  ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1),
  ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/cccccccccccccccccccccccccccccccccccccccc', 2);
SQL
expect_scalar 'three gallery rows persist in order' \
  'gdrive/public/business-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|gdrive/public/business-image/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|gdrive/public/business-image/cccccccccccccccccccccccccccccccccccccccc' \
  "select string_agg(object_key, '|' order by sort_order) from business_application_photos where application_id = '33333333-3333-4333-8333-333333333333'"

# ------------------------------------------------------- 4. fail-closed
expect_fail 'sort_order 3 rejected by check constraint' \
  "insert into business_application_photos (application_id, object_key, sort_order) values ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/dddddddddddddddddddddddddddddddddddddddd', 3)"

expect_fail 'duplicate slot rejected' \
  "insert into business_application_photos (application_id, object_key, sort_order) values ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/dddddddddddddddddddddddddddddddddddddddd', 0)"

expect_fail 'duplicate object key rejected' \
  "insert into business_application_photos (application_id, object_key, sort_order) values ('33333333-3333-4333-8333-333333333333', 'gdrive/public/business-image/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1)"

expect_fail 'non business-image namespace rejected' \
  "insert into business_application_photos (application_id, object_key, sort_order) values ('33333333-3333-4333-8333-333333333333', 'gdrive/private/resident-evidence/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1)"

expect_fail 'unknown application rejected by FK' \
  "insert into business_application_photos (application_id, object_key, sort_order) values ('44444444-4444-4444-8444-444444444444', 'gdrive/public/business-image/dddddddddddddddddddddddddddddddddddddddd', 0)"

# ------------------------------------------------------- 5. cascade
"${psql_cmd[@]}" -c "delete from business_applications where id = '33333333-3333-4333-8333-333333333333'"
expect_scalar 'gallery rows cascade with application' \
  '0' \
  "select count(*) from business_application_photos where application_id = '33333333-3333-4333-8333-333333333333'"

# ------------------------------------------------------- 6. cleanup
"${psql_cmd[@]}" <<'SQL'
delete from app_users where id = '22222222-2222-4222-8222-222222222222';
delete from complexes where id = '11111111-1111-4111-8111-111111111111';
SQL
echo "PASS lifecycle scratch rows cleaned"
echo "ALL PASS business application photos 044 postgres lifecycle"
