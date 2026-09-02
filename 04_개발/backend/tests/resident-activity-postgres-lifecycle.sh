#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/013_community_core.sql
"${psql_cmd[@]}" -f migrations/027_business_reviews.sql
"${psql_cmd[@]}" -f migrations/028_community_comment_replies.sql
"${psql_cmd[@]}" -f migrations/031_resident_activity_indexes.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'activity-complex', 'Activity Complex', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'activity-user', '활동주민'),
  ('20000000-0000-4000-8000-000000000002', 'other-user', '다른주민');

insert into businesses (id, owner_user_id, kind, name, summary, description, status) values
  ('30000000-0000-4000-8000-000000000001', null, 'service', '활동가게', '활동 테스트', '활동 테스트', 'approved');

insert into business_complex_relations (
  business_id, complex_id, relation_type, verification_status, priority, verified_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'neighbor', 'verified', 100, now()
);

insert into community_posts (
  id, complex_id, author_user_id, kind, title, body, status, published_at, hidden_at, deleted_at, created_at
) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'resident_story', '공개 글', 'VISIBLE POST BODY', 'published', now(), null, null, '2026-09-01T10:00:00Z'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'resident_story', '숨김 글', 'HIDDEN POST SECRET', 'hidden', null, now(), null, '2026-09-01T09:00:00Z'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'resident_story', '다른 주민 글', 'OTHER POST', 'published', now(), null, null, '2026-09-01T08:00:00Z'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'resident_story', '숨겨진 반응대상', 'REACTION TARGET SECRET', 'hidden', null, now(), null, '2026-09-01T07:00:00Z');

insert into community_comments (
  id, complex_id, post_id, author_user_id, body, status, published_at, hidden_at, deleted_at, created_at
) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'VISIBLE COMMENT BODY', 'published', now(), null, null, '2026-09-01T11:00:00Z'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'HIDDEN COMMENT SECRET', 'hidden', null, now(), null, '2026-09-01T12:00:00Z');

insert into community_comments (
  id, complex_id, post_id, parent_comment_id, author_user_id, body, status, published_at, created_at
) values (
  '50000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'VISIBLE REPLY BODY', 'published', now(), '2026-09-01T13:00:00Z'
);

insert into community_reactions (id, complex_id, post_id, user_id, reaction_type, created_at) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'like', '2026-09-01T14:00:00Z'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'like', '2026-09-01T15:00:00Z');

insert into business_reviews (
  id, complex_id, business_id, author_user_id, body, status, created_at
) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'VISIBLE REVIEW BODY', 'active', '2026-09-01T16:00:00Z'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'DELETED REVIEW SECRET', 'deleted', '2026-09-01T17:00:00Z');

-- Missing author/user access paths must be present without creating an activity table.
do $$
declare
  comment_idx integer;
  reaction_idx integer;
  activity_table integer;
begin
  select count(*) into comment_idx from pg_indexes where schemaname = 'public' and indexname = 'idx_community_comments_activity_author';
  select count(*) into reaction_idx from pg_indexes where schemaname = 'public' and indexname = 'idx_community_reactions_activity_user';
  select count(*) into activity_table from information_schema.tables where table_schema = 'public' and table_name in ('activity','activities','resident_activity','resident_activities');
  if comment_idx <> 1 or reaction_idx <> 1 then
    raise exception 'activity access indexes missing: comments=% reactions=%', comment_idx, reaction_idx;
  end if;
  if activity_table <> 0 then
    raise exception 'activity must remain derived; duplicate activity table exists';
  end if;
end $$;

create temporary table activity_projection as
with activity as (
  select 'post'::text as activity_type, p.id, p.created_at as occurred_at, p.status,
         'community_post'::text as target_type, p.id as target_id, null::uuid as parent_comment_id,
         p.title,
         case when p.status in ('pending_review','published') then left(p.body, 280) else null end as body_preview
  from community_posts p
  where p.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
    and p.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
  union all
  select case when c.parent_comment_id is null then 'comment'::text else 'reply'::text end,
         c.id, c.created_at, c.status, 'community_post'::text, c.post_id, c.parent_comment_id, p.title,
         case when c.status in ('pending_review','published') then left(c.body, 280) else null end
  from community_comments c
  join community_posts p on p.id = c.post_id and p.complex_id = c.complex_id
  where c.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
    and c.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
  union all
  select 'reaction'::text, r.id, r.created_at, p.status, 'community_post'::text, r.post_id,
         null::uuid, case when p.status = 'published' then p.title else null end, null::text
  from community_reactions r
  join community_posts p on p.id = r.post_id and p.complex_id = r.complex_id
  where r.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
    and r.user_id = '20000000-0000-4000-8000-000000000001'::uuid
  union all
  select 'review'::text, br.id, br.created_at, br.status, 'business'::text, br.business_id,
         null::uuid, b.name, case when br.status = 'active' then left(br.body, 280) else null end
  from business_reviews br
  join businesses b on b.id = br.business_id
  where br.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
    and br.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
)
select * from activity;

do $$
declare
  total integer;
  post_count integer;
  comment_count integer;
  reply_count integer;
  reaction_count integer;
  review_count integer;
  leaked integer;
  hidden_reaction_title text;
  first_type text;
  first_id uuid;
  second_type text;
  second_id uuid;
begin
  select count(*) into total from activity_projection;
  select count(*) into post_count from activity_projection where activity_type = 'post';
  select count(*) into comment_count from activity_projection where activity_type = 'comment';
  select count(*) into reply_count from activity_projection where activity_type = 'reply';
  select count(*) into reaction_count from activity_projection where activity_type = 'reaction';
  select count(*) into review_count from activity_projection where activity_type = 'review';
  if total <> 9 or post_count <> 2 or comment_count <> 2 or reply_count <> 1 or reaction_count <> 2 or review_count <> 2 then
    raise exception 'unexpected activity projection: total=% post=% comment=% reply=% reaction=% review=%', total, post_count, comment_count, reply_count, reaction_count, review_count;
  end if;

  select count(*) into leaked
  from activity_projection
  where coalesce(body_preview, '') like '%SECRET%';
  if leaked <> 0 then
    raise exception 'hidden/deleted private body leaked through activity projection';
  end if;

  select title into hidden_reaction_title
  from activity_projection
  where id = '60000000-0000-4000-8000-000000000002'::uuid;
  if hidden_reaction_title is not null then
    raise exception 'hidden reaction target title leaked: %', hidden_reaction_title;
  end if;

  select activity_type, id into first_type, first_id
  from activity_projection
  order by occurred_at desc, activity_type desc, id::text desc
  limit 1;
  select activity_type, id into second_type, second_id
  from activity_projection
  where (occurred_at, activity_type, id::text) < (
    select occurred_at, activity_type, id::text
    from activity_projection
    where activity_type = first_type and id = first_id
  )
  order by occurred_at desc, activity_type desc, id::text desc
  limit 1;
  if first_id = second_id or first_id is null or second_id is null then
    raise exception 'cursor tuple did not advance deterministically';
  end if;
end $$;
SQL

echo "PASS resident activity PostgreSQL lifecycle: derived source data, privacy masking, indexes and tuple pagination"
