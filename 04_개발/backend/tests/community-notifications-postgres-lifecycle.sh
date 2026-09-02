#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/013_community_core.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql
"${psql_cmd[@]}" -f migrations/025_resident_notifications.sql
"${psql_cmd[@]}" -f migrations/028_community_comment_replies.sql
"${psql_cmd[@]}" -f migrations/035_community_notification_producers.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'sub-A', 'Author A'),
  ('20000000-0000-4000-8000-000000000002', 'sub-B', 'Neighbor B'),
  ('20000000-0000-4000-8000-000000000003', 'sub-C', 'Neighbor C');

insert into community_posts (
  id, complex_id, author_user_id, kind, title, body, status, published_at
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'question', 'Published post', 'POST BODY MUST NOT ENTER NOTIFICATIONS', 'published', now()
);

-- Review-mode comment: insertion must not alert before publication.
insert into community_comments (
  id, complex_id, post_id, author_user_id, body, status
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'COMMENT PRIVATE BODY MUST NOT ENTER NOTIFICATIONS',
  'pending_review'
);

do $$
declare n integer;
begin
  select count(*) into n from notifications;
  if n <> 0 then raise exception 'pending comment produced notification count=%', n; end if;
end $$;

-- First publication emits exactly one notification to the post author.
update community_comments
set status = 'published', published_at = now()
where id = '40000000-0000-4000-8000-000000000001'::uuid;

do $$
declare
  n integer;
  recipient uuid;
  actor uuid;
  kind text;
  resource_kind text;
  resource uuid;
  event_key text;
  stored_title text;
begin
  select count(*) into n from notifications;
  if n <> 1 then raise exception 'published comment expected one notification, got %', n; end if;

  select user_id, actor_user_id, type, resource_type, resource_id, source_event_key, title
    into recipient, actor, kind, resource_kind, resource, event_key, stored_title
  from notifications
  where source_event_key = 'community-comment:40000000-0000-4000-8000-000000000001';

  if recipient <> '20000000-0000-4000-8000-000000000001'::uuid then raise exception 'wrong comment recipient %', recipient; end if;
  if actor <> '20000000-0000-4000-8000-000000000002'::uuid then raise exception 'wrong comment actor %', actor; end if;
  if kind <> 'community_comment' then raise exception 'wrong comment notification type %', kind; end if;
  if resource_kind <> 'community_post' or resource <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'wrong comment resource % / %', resource_kind, resource;
  end if;
  if event_key <> 'community-comment:40000000-0000-4000-8000-000000000001' then raise exception 'wrong comment event key %', event_key; end if;
  if stored_title like '%COMMENT PRIVATE BODY%' or stored_title like '%POST BODY%' then raise exception 'content body leaked into title'; end if;
end $$;

-- Hide then restore must not duplicate the logical comment event.
update community_comments
set status = 'hidden', hidden_at = now()
where id = '40000000-0000-4000-8000-000000000001'::uuid;
update community_comments
set status = 'published', hidden_at = null
where id = '40000000-0000-4000-8000-000000000001'::uuid;

do $$
declare n integer;
begin
  select count(*) into n from notifications where source_event_key = 'community-comment:40000000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'comment restore duplicated event count=%', n; end if;
end $$;

-- Nested reply stays silent while pending, then targets the parent comment author.
insert into community_comments (
  id, complex_id, post_id, parent_comment_id, author_user_id, body, status
) values (
  '40000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000003',
  'REPLY BODY MUST NOT ENTER NOTIFICATIONS',
  'pending_review'
);

do $$
declare n integer;
begin
  select count(*) into n from notifications;
  if n <> 1 then raise exception 'pending reply changed notification count=%', n; end if;
end $$;

update community_comments
set status = 'published', published_at = now()
where id = '40000000-0000-4000-8000-000000000002'::uuid;

do $$
declare
  recipient uuid;
  actor uuid;
  kind text;
  resource uuid;
  stored_title text;
begin
  select user_id, actor_user_id, type, resource_id, title
    into recipient, actor, kind, resource, stored_title
  from notifications
  where source_event_key = 'community-comment:40000000-0000-4000-8000-000000000002';

  if recipient <> '20000000-0000-4000-8000-000000000002'::uuid then raise exception 'wrong reply recipient %', recipient; end if;
  if actor <> '20000000-0000-4000-8000-000000000003'::uuid then raise exception 'wrong reply actor %', actor; end if;
  if kind <> 'community_reply' then raise exception 'wrong reply notification type %', kind; end if;
  if resource <> '30000000-0000-4000-8000-000000000001'::uuid then raise exception 'wrong reply resource %', resource; end if;
  if stored_title like '%REPLY BODY%' then raise exception 'reply body leaked into title'; end if;
end $$;

-- Reaction on a published post targets the post author.
insert into community_reactions (
  id, complex_id, post_id, user_id, reaction_type
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'like'
);

do $$
declare
  recipient uuid;
  actor uuid;
  kind text;
  event_key text;
begin
  select user_id, actor_user_id, type, source_event_key
    into recipient, actor, kind, event_key
  from notifications
  where source_event_key = 'community-reaction:50000000-0000-4000-8000-000000000001';
  if recipient <> '20000000-0000-4000-8000-000000000001'::uuid then raise exception 'wrong reaction recipient %', recipient; end if;
  if actor <> '20000000-0000-4000-8000-000000000002'::uuid then raise exception 'wrong reaction actor %', actor; end if;
  if kind <> 'community_reaction' then raise exception 'wrong reaction type %', kind; end if;
  if event_key <> 'community-reaction:50000000-0000-4000-8000-000000000001' then raise exception 'wrong reaction event key %', event_key; end if;
end $$;

-- Self comment and self reaction must not create notifications.
insert into community_comments (
  id, complex_id, post_id, author_user_id, body, status, published_at
) values (
  '40000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'self comment', 'published', now()
);

insert into community_reactions (
  id, complex_id, post_id, user_id, reaction_type
) values (
  '50000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'like'
);

-- Reactions to a non-published post must not notify.
insert into community_posts (
  id, complex_id, author_user_id, kind, title, body, status
) values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'question', 'Pending post', 'pending', 'pending_review'
);
insert into community_reactions (
  id, complex_id, post_id, user_id, reaction_type
) values (
  '50000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'like'
);

do $$
declare n integer;
begin
  select count(*) into n from notifications;
  if n <> 3 then raise exception 'expected exactly comment+reply+reaction notifications, got %', n; end if;
  if exists (select 1 from notifications where actor_user_id = user_id) then raise exception 'self notification detected'; end if;
  if exists (select 1 from notifications where title like '%BODY MUST NOT%') then raise exception 'content body leaked into notification'; end if;
end $$;
SQL

echo "PASS Community notification PostgreSQL lifecycle: publish-only comment/reply routing, reaction routing, self suppression, dedupe, no body copy"
