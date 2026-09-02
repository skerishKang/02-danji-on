#!/usr/bin/env bash
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

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/027_business_reviews.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'complex-2', 'Complex Two', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'resident-a', 'Resident A'),
  ('20000000-0000-4000-8000-000000000002', 'owner-b', 'Owner B'),
  ('20000000-0000-4000-8000-000000000003', 'attacker-c', 'Attacker C');

insert into business_categories (id, slug, name) values
  ('30000000-0000-4000-8000-000000000001', 'food', 'Food');

insert into businesses (id, owner_user_id, category_id, kind, name, status) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'shop', 'Owner Shop', 'approved');

insert into business_complex_relations (id, business_id, complex_id, relation_type, verification_status) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resident', 'verified');

insert into business_reviews (id, complex_id, business_id, author_user_id, body) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Helpful neighborhood shop');

insert into business_review_replies (review_id, business_id, complex_id, owner_user_id, body) values
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Thank you for the review');
SQL

expect_fail \
  "non-owner reply rejected" \
  "update business_review_replies set owner_user_id='20000000-0000-4000-8000-000000000003' where review_id='60000000-0000-4000-8000-000000000001'"

expect_fail \
  "cross-complex review rejected" \
  "insert into business_reviews (complex_id,business_id,author_user_id,body) values ('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','cross complex')"

expect_fail \
  "empty review rejected" \
  "insert into business_reviews (complex_id,business_id,author_user_id,body) values ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','')"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  review_count integer;
  reply_count integer;
  owner_id uuid;
begin
  select count(*) into review_count
  from business_reviews
  where business_id = '40000000-0000-4000-8000-000000000001'
    and complex_id = '10000000-0000-4000-8000-000000000001'
    and status = 'active';
  if review_count <> 1 then
    raise exception 'expected exactly one active review, got %', review_count;
  end if;

  select count(*) into reply_count
  from business_review_replies
  where review_id = '60000000-0000-4000-8000-000000000001';

  select owner_user_id into owner_id
  from business_review_replies
  where review_id = '60000000-0000-4000-8000-000000000001';

  if reply_count <> 1 or owner_id <> '20000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'owner reply integrity failed: count=% owner=%', reply_count, owner_id;
  end if;
end $$;
SQL

echo "PASS business reviews PostgreSQL lifecycle: tenant FK, text bounds, canonical owner reply enforcement"
