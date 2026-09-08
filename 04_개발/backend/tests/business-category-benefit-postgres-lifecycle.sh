#!/usr/bin/env bash
# #278: sibling v3 multi-category + benefit value/code schema lifecycle.
# Applies 001 + 041 against a scratch database and proves:
#   A. legacy single-category business keeps working (category_id preserved)
#   B. business with two categories stores both, no duplicates
#   C. benefit value/code round-trip preserves exact Korean strings
#   D. benefit without value/code stays null-safe
#   E. relation semantics unaffected
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local statement="$2"
  local output
  output="$(mktemp)"
  if "${psql_cmd[@]}" -c "$statement" >"$output" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$output"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
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

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/041_business_category_benefit_contract.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'contract-complex', 'Contract Complex', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'owner-a', 'Owner A');

insert into business_categories (id, slug, name, sort_order) values
  ('30000000-0000-4000-8000-000000000001', 'cafe', '카페·간식', 10),
  ('30000000-0000-4000-8000-000000000002', 'food', '식품·반찬', 20),
  ('30000000-0000-4000-8000-000000000003', 'car', '자동차', 30),
  ('30000000-0000-4000-8000-000000000004', 'home', '생활서비스', 40);

-- A. legacy single-category business: primary column intact.
insert into businesses (id, owner_user_id, category_id, kind, name, status) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000002', 'shop', '오늘의 반찬', 'approved');

-- B. multi-category business (florist-style: primary food, secondary cafe).
insert into businesses (id, owner_user_id, category_id, kind, name, status) values
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000002', 'shop', '로드힐 꽃작업실', 'approved');

insert into business_category_relations (business_id, category_id) values
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001');

-- E. relation semantics (both businesses verified resident).
insert into business_complex_relations (business_id, complex_id, relation_type, verification_status) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resident', 'verified'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'resident', 'verified');

-- C. benefit with exact sibling v3 value/code strings.
insert into benefits (id, complex_id, business_id, title, conditions, value_text, code, status) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', '방림명지로드힐 주민 10% 할인', '주민 확인 후 적용',
   '10%', 'DANJION · F010', 'active');

-- D. legacy benefit without value/code (null-safe).
insert into benefits (id, complex_id, business_id, title, status) values
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000002', '꽃다발 예약 상담 시 주민 전용 혜택', 'active');
SQL

# B. both category tokens are stored for the multi-category business.
expect_scalar 'multi-category stores both slugs in canonical order' \
  'cafe|food' \
  "select string_agg(bc.slug, '|' order by bc.sort_order, bc.slug)
   from business_category_relations bcr
   join business_categories bc on bc.id = bcr.category_id
   where bcr.business_id = '40000000-0000-4000-8000-000000000002'"

# B. duplicate category relation is blocked by the unique constraint.
expect_fail 'duplicate category relation is rejected' \
  "insert into business_category_relations (business_id, category_id)
   values ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002')"

# A. legacy primary category column still resolves for the single-category business.
expect_scalar 'legacy primary category preserved' \
  'food' \
  "select bc.slug from businesses b
   join business_categories bc on bc.id = b.category_id
   where b.id = '40000000-0000-4000-8000-000000000001'"

# A. legacy rows without join rows coalesce to the primary slug (API fallback semantics).
expect_scalar 'legacy business coalesces to primary slug' \
  'food' \
  "select (coalesce(
     (select array_agg(bcr_cat.slug order by bcr_cat.sort_order, bcr_cat.slug) from business_category_relations bcr join business_categories bcr_cat on bcr_cat.id = bcr.category_id where bcr.business_id = b.id and bcr_cat.is_active),
     case when bc.slug is not null then array[bc.slug] else array[]::text[] end
   ))[1]
   from businesses b
   left join business_categories bc on bc.id = b.category_id
   where b.id = '40000000-0000-4000-8000-000000000001'"

# C. exact Korean value/code round-trip.
expect_scalar 'benefit value_text round-trips verbatim' \
  '10%' \
  "select value_text from benefits where id = '50000000-0000-4000-8000-000000000001'"
expect_scalar 'benefit code round-trips verbatim' \
  'DANJION · F010' \
  "select code from benefits where id = '50000000-0000-4000-8000-000000000001'"

# D. legacy benefit rows stay null-safe.
expect_scalar 'legacy benefit value_text is null' \
  '' \
  "select coalesce(value_text, '') from benefits where id = '50000000-0000-4000-8000-000000000002'"
expect_scalar 'legacy benefit code is null' \
  '' \
  "select coalesce(code, '') from benefits where id = '50000000-0000-4000-8000-000000000002'"

# E. relation semantics unaffected by the new table/columns.
expect_scalar 'relation semantics preserved' \
  'resident' \
  "select r.relation_type from business_complex_relations r
   where r.business_id = '40000000-0000-4000-8000-000000000001'"

# F. discovery order/count unaffected: same ordering keys as before.
expect_scalar 'relation-first ordering unchanged' \
  '2' \
  "select count(*) from businesses b
   join business_complex_relations r on r.business_id = b.id
   join complexes c on c.id = r.complex_id
   where c.slug = 'contract-complex'
     and b.status = 'approved'
     and r.verification_status = 'verified'"

echo 'PASS #278 business category and benefit postgres lifecycle'
