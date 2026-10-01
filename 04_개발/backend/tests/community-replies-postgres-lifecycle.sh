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


# #1104: parent-state transition must win atomically when it owns the row lock first.
# The child write uses the same lock-bearing CTE shape as Production source.
assert_scalar() {
  local statement="$1"
  local expected="$2"
  local label="$3"
  local actual
  actual=$("${psql_cmd[@]}" -Atc "$statement" | tr -d '[:space:]')
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL ${label}: expected=${expected} actual=${actual}" >&2
    exit 1
  fi
  echo "PASS ${label}"
}

HOLD_SECONDS=3
BLOCK_MIN_SECONDS=2

# Reply: delete owns the parent-comment lock first. The reply statement must block,
# re-check the committed deleted state, and insert zero rows.
"${psql_cmd[@]}" -c "
  update community_comments
  set status='published', deleted_at=null
  where id='40000000-0000-4000-8000-000000000001';
  delete from community_comments
  where parent_comment_id='40000000-0000-4000-8000-000000000001';
"

(
  "${psql_cmd[@]}" <<SQL
begin;
select id from community_comments
where id='40000000-0000-4000-8000-000000000001'
for update;
select pg_sleep(${HOLD_SECONDS});
update community_comments
set status='deleted', deleted_at=now()
where id='40000000-0000-4000-8000-000000000001';
commit;
SQL
) &
PARENT_DELETE_PID=$!

sleep 0.25
START_TS=$(date +%s)
"${psql_cmd[@]}" <<'SQL'
with locked_parent as (
  select c.id
  from community_comments c
  join community_posts p on p.id=c.post_id and p.complex_id=c.complex_id
  where c.id='40000000-0000-4000-8000-000000000001'
    and c.post_id='30000000-0000-4000-8000-000000000001'
    and c.complex_id='10000000-0000-4000-8000-000000000001'
    and c.status <> 'deleted'
    and c.status='published'
    and p.status <> 'deleted'
    and p.status='published'
  limit 1
  for update of c, p
)
insert into community_comments (
  id, complex_id, post_id, parent_comment_id, author_user_id, body, status, published_at
)
select
  '50000000-0000-4000-8000-000000000010',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  locked_parent.id,
  '20000000-0000-4000-8000-000000000002',
  'must not survive parent delete',
  'published',
  now()
from locked_parent;
SQL
END_TS=$(date +%s)
wait "$PARENT_DELETE_PID"
ELAPSED=$((END_TS - START_TS))
if [[ "$ELAPSED" -lt "$BLOCK_MIN_SECONDS" ]]; then
  echo "FAIL #1104 reply insert did not block on parent lock: elapsed=${ELAPSED}s" >&2
  exit 1
fi
assert_scalar "select count(*) from community_comments where id='50000000-0000-4000-8000-000000000010'" "0" "#1104 delete-wins reply denied"

# Top-level comment: delete owns the post lock first. The comment statement must
# block, re-check the deleted post state, and insert zero rows.
"${psql_cmd[@]}" -c "
  update community_posts
  set status='published', deleted_at=null
  where id='30000000-0000-4000-8000-000000000002';
  delete from community_comments
  where post_id='30000000-0000-4000-8000-000000000002';
"

(
  "${psql_cmd[@]}" <<SQL
begin;
select id from community_posts
where id='30000000-0000-4000-8000-000000000002'
for update;
select pg_sleep(${HOLD_SECONDS});
update community_posts
set status='deleted', deleted_at=now()
where id='30000000-0000-4000-8000-000000000002';
commit;
SQL
) &
POST_DELETE_PID=$!

sleep 0.25
START_TS=$(date +%s)
"${psql_cmd[@]}" <<'SQL'
with locked_post as (
  select p.id
  from community_posts p
  where p.id='30000000-0000-4000-8000-000000000002'
    and p.complex_id='10000000-0000-4000-8000-000000000001'
    and p.status <> 'deleted'
    and p.status='published'
  limit 1
  for update of p
)
insert into community_comments (
  id, complex_id, post_id, author_user_id, body, status, published_at
)
select
  '50000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000001',
  locked_post.id,
  '20000000-0000-4000-8000-000000000002',
  'must not survive post delete',
  'published',
  now()
from locked_post;
SQL
END_TS=$(date +%s)
wait "$POST_DELETE_PID"
ELAPSED=$((END_TS - START_TS))
if [[ "$ELAPSED" -lt "$BLOCK_MIN_SECONDS" ]]; then
  echo "FAIL #1104 comment insert did not block on post lock: elapsed=${ELAPSED}s" >&2
  exit 1
fi
assert_scalar "select count(*) from community_comments where id='50000000-0000-4000-8000-000000000011'" "0" "#1104 delete-wins top-level comment denied"

echo "PASS #1104 Community child-write serialization: parent-state transition wins safely under lock contention"
