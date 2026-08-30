#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

expect_fail() {
  local label="$1"
  local sql="$2"
  local output
  output="$(mktemp)"
  if "${psql_cmd[@]}" -c "$sql" >"$output" 2>&1; then
    echo "FAIL ${label}: statement unexpectedly succeeded"
    cat "$output"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
  echo "PASS ${label}"
}

# The Community migration depends only on the initial identity/complex tables and
# set_updated_at() trigger helper. This job uses its own ephemeral PostgreSQL DB.
"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/013_community_core.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'complex-2', 'Complex Two', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'sub-A', 'A-neighbor'),
  ('20000000-0000-4000-8000-000000000002', 'sub-B', 'B-neighbor'),
  ('20000000-0000-4000-8000-000000000003', 'sub-C', 'C-neighbor'),
  ('20000000-0000-4000-8000-000000000004', 'sub-O', 'Operator');

-- Official content stays in complex_posts and is never used as the resident table.
insert into complex_posts (
  id, complex_id, author_user_id, source_name, category, title, body, status, published_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004',
  'DanjiOn Official', 'notice', 'Official C1 Notice', 'Official-only content', 'published', now()
);

-- A publishes in complex-1. C publishes independently in complex-2.
insert into community_posts (
  id, complex_id, author_user_id, kind, title, body, status, published_at
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'question', 'Resident C1 Post', 'A asks the neighbors', 'published', now()
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    'resident_story', 'Resident C2 Post', 'C belongs to another complex', 'published', now()
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'life_report', 'Owner Scope Probe', 'Original owner body', 'published', now()
  );

-- B can create a same-complex comment when the application AuthZ gate has admitted B.
insert into community_comments (
  id, complex_id, post_id, author_user_id, body, status, published_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'B replies in the same complex', 'published', now()
);

-- The actual mutation SQL is owner-scoped. A different resident cannot alter A's row.
update community_posts
set body = 'B should not be able to write this'
where id = '40000000-0000-4000-8000-000000000003'
  and complex_id = '10000000-0000-4000-8000-000000000001'
  and author_user_id = '20000000-0000-4000-8000-000000000002';

-- A's owner-scoped mutation succeeds.
update community_posts
set body = 'A updated own post'
where id = '40000000-0000-4000-8000-000000000003'
  and complex_id = '10000000-0000-4000-8000-000000000001'
  and author_user_id = '20000000-0000-4000-8000-000000000001';

-- Reaction insertion mirrors the API's ON CONFLICT idempotency behavior.
insert into community_reactions (id, complex_id, post_id, user_id, reaction_type)
values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'like'
);

insert into community_reactions (complex_id, post_id, user_id, reaction_type)
values (
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'like'
)
on conflict (post_id, user_id, reaction_type) do nothing;

insert into community_reports (
  id, complex_id, reporter_user_id, post_id, reason, detail
) values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  'other', 'Synthetic report'
);

-- Operator hide/restore is state-only and accompanied by immutable events.
update community_posts
set status = 'hidden', hidden_at = now()
where id = '40000000-0000-4000-8000-000000000001'
  and complex_id = '10000000-0000-4000-8000-000000000001';

insert into community_moderation_events (
  id, complex_id, post_id, actor_kind, operator_user_id, action, reason_code, note
) values (
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'operator',
  '20000000-0000-4000-8000-000000000004',
  'hidden', 'synthetic_c6', 'C6 hide evidence'
);

update community_posts
set status = 'published', hidden_at = null
where id = '40000000-0000-4000-8000-000000000001'
  and complex_id = '10000000-0000-4000-8000-000000000001';

insert into community_moderation_events (
  id, complex_id, post_id, actor_kind, operator_user_id, action, reason_code, note
) values (
  '80000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'operator',
  '20000000-0000-4000-8000-000000000004',
  'restored', 'synthetic_c6', 'C6 restore evidence'
);
SQL

# Composite tenant foreign keys reject a comment that claims complex-2 while
# pointing at a complex-1 post.
expect_fail \
  "cross-complex comment FK isolation" \
  "insert into community_comments (complex_id, post_id, author_user_id, body, status, published_at) values ('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','cross tenant','published',now())"

# Composite tenant foreign keys likewise reject cross-complex reactions.
expect_fail \
  "cross-complex reaction FK isolation" \
  "insert into community_reactions (complex_id, post_id, user_id, reaction_type) values ('10000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','like')"

# The partial unique report index prevents a resident from opening the same report twice.
expect_fail \
  "duplicate open report rejected" \
  "insert into community_reports (complex_id, reporter_user_id, post_id, reason) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','spam')"

"${psql_cmd[@]}" <<'SQL'
do $$
declare
  c1_feed_count integer;
  c2_leak_count integer;
  reaction_count integer;
  report_count integer;
  event_count integer;
  event_actions text[];
  owner_body text;
  official_resident_leak integer;
  resident_official_leak integer;
begin
  select count(*) into c1_feed_count
  from community_posts
  where complex_id = '10000000-0000-4000-8000-000000000001'
    and status = 'published';
  if c1_feed_count <> 2 then
    raise exception 'complex-1 published feed expected 2 rows, got %', c1_feed_count;
  end if;

  select count(*) into c2_leak_count
  from community_posts
  where complex_id = '10000000-0000-4000-8000-000000000001'
    and title = 'Resident C2 Post';
  if c2_leak_count <> 0 then
    raise exception 'cross-complex resident row leaked into complex-1 feed';
  end if;

  select count(*) into reaction_count
  from community_reactions
  where post_id = '40000000-0000-4000-8000-000000000001'
    and user_id = '20000000-0000-4000-8000-000000000002'
    and reaction_type = 'like';
  if reaction_count <> 1 then
    raise exception 'reaction idempotency expected 1 row, got %', reaction_count;
  end if;

  select count(*) into report_count
  from community_reports
  where reporter_user_id = '20000000-0000-4000-8000-000000000002'
    and post_id = '40000000-0000-4000-8000-000000000001'
    and status in ('submitted','reviewing');
  if report_count <> 1 then
    raise exception 'open report uniqueness expected 1 row, got %', report_count;
  end if;

  select count(*), array_agg(action order by created_at, id)
  into event_count, event_actions
  from community_moderation_events
  where post_id = '40000000-0000-4000-8000-000000000001';
  if event_count <> 2 or event_actions <> array['hidden','restored']::text[] then
    raise exception 'moderation audit expected hidden/restored, got % / %', event_count, event_actions;
  end if;

  if (select status from community_posts where id = '40000000-0000-4000-8000-000000000001') <> 'published' then
    raise exception 'post should be restored to published';
  end if;

  select body into owner_body
  from community_posts
  where id = '40000000-0000-4000-8000-000000000003';
  if owner_body <> 'A updated own post' then
    raise exception 'owner-scoped update contract failed: %', owner_body;
  end if;

  select count(*) into official_resident_leak
  from complex_posts
  where title like 'Resident C%';
  if official_resident_leak <> 0 then
    raise exception 'resident content leaked into official complex_posts';
  end if;

  select count(*) into resident_official_leak
  from community_posts
  where title = 'Official C1 Notice';
  if resident_official_leak <> 0 then
    raise exception 'official content leaked into resident community_posts';
  end if;
end $$;
SQL

echo "PASS Community C6 real PostgreSQL lifecycle: tenant isolation, owner scope, reaction idempotency, report uniqueness, moderation audit, official/resident separation"
