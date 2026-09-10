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
"${psql_cmd[@]}" -f migrations/043_business_review_comments.sql

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
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'shop', 'Owner Shop', 'approved'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'shop', 'Other Shop', 'approved');

insert into business_complex_relations (id, business_id, complex_id, relation_type, verification_status) values
  ('50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resident', 'verified'),
  ('50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'resident', 'verified');

insert into business_reviews (id, complex_id, business_id, author_user_id, body) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Helpful neighborhood shop');

insert into business_review_replies (review_id, business_id, complex_id, owner_user_id, body) values
  ('60000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'Thank you for the review');

insert into business_review_comments (id, complex_id, business_id, review_id, author_user_id, body) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Warm follow-up comment');
SQL

expect_fail \
  "empty comment rejected" \
  "insert into business_review_comments (complex_id,business_id,review_id,author_user_id,body) values ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','')"

expect_fail \
  "over-500 comment rejected" \
  "insert into business_review_comments (complex_id,business_id,review_id,author_user_id,body) values ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',repeat('x',501))"

expect_fail \
  "cross-complex comment rejected" \
  "insert into business_review_comments (complex_id,business_id,review_id,author_user_id,body) values ('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','cross complex')"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  comment_count integer;
  reply_count integer;
  reply_body text;
begin
  select count(*) into comment_count
  from business_review_comments
  where review_id = '60000000-0000-4000-8000-000000000001'
    and status = 'active';
  if comment_count <> 1 then
    raise exception 'expected one active comment, got %', comment_count;
  end if;
  update business_review_comments
  set body = 'Edited by author'
  where id = '70000000-0000-4000-8000-000000000001'
    and author_user_id = '20000000-0000-4000-8000-000000000001'
    and status = 'active';
  if not found then
    raise exception 'author update failed';
  end if;
  update business_review_comments
  set status = 'deleted'
  where id = '70000000-0000-4000-8000-000000000001'
    and author_user_id = '20000000-0000-4000-8000-000000000001'
    and status = 'active';
  select count(*) into comment_count
  from business_review_comments
  where review_id = '60000000-0000-4000-8000-000000000001'
    and status = 'active';
  if comment_count <> 0 then
    raise exception 'soft-delete failed, active=%', comment_count;
  end if;
  select count(*), max(body) into reply_count, reply_body
  from business_review_replies
  where review_id = '60000000-0000-4000-8000-000000000001';
  if reply_count <> 1 or reply_body <> 'Thank you for the review' then
    raise exception 'owner reply changed: count=% body=%', reply_count, reply_body;
  end if;
end $$;
SQL

echo "PASS business review comments PostgreSQL lifecycle"


