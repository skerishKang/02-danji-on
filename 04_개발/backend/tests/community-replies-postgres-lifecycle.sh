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
"${psql_cmd[@]}" -f migrations/013_community_core.sql
"${psql_cmd[@]}" -f migrations/028_community_comment_replies.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'complex-2', 'Complex Two', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'user-a', 'A'),
  ('20000000-0000-4000-8000-000000000002', 'user-b', 'B');

insert into community_posts (id, complex_id, author_user_id, kind, title, body, status, published_at) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'question', 'Post One', 'Body One', 'published', now()),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'question', 'Post Two', 'Body Two', 'published', now()),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'question', 'Post Three', 'Body Three', 'published', now());

insert into community_comments (id, complex_id, post_id, author_user_id, body, status, published_at) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Parent One', 'published', now()),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Parent Two', 'published', now()),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Parent Three', 'published', now());

insert into community_comments (
  id, complex_id, post_id, parent_comment_id, author_user_id, body, status, published_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'Valid child reply',
  'published',
  now()
);
SQL

expect_fail \
  "cross-post parent rejected" \
  "insert into community_comments (complex_id,post_id,parent_comment_id,author_user_id,body,status,published_at) values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','wrong post parent','published',now())"

expect_fail \
  "cross-complex parent rejected" \
  "insert into community_comments (complex_id,post_id,parent_comment_id,author_user_id,body,status,published_at) values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','wrong complex parent','published',now())"

expect_fail \
  "self parent rejected" \
  "update community_comments set parent_comment_id='40000000-0000-4000-8000-000000000001' where id='40000000-0000-4000-8000-000000000001'"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  child_parent uuid;
  child_body text;
  child_status text;
begin
  select parent_comment_id, body, status
  into child_parent, child_body, child_status
  from community_comments
  where id = '50000000-0000-4000-8000-000000000001';

  if child_parent <> '40000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'parent relation lost: %', child_parent;
  end if;
  if child_body <> 'Valid child reply' or child_status <> 'published' then
    raise exception 'reply payload/status changed unexpectedly: % / %', child_body, child_status;
  end if;
end $$;
SQL

echo "PASS Community replies PostgreSQL lifecycle: same-post/complex parent FK, self-parent guard, reply persistence"
