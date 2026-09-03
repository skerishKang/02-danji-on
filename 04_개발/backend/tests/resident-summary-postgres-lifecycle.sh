#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/009_household_foundation.sql
"${psql_cmd[@]}" -f migrations/013_community_core.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active'),
  ('10000000-0000-4000-8000-000000000002', 'complex-2', 'Complex Two', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'resident-a', 'Resident A'),
  ('20000000-0000-4000-8000-000000000002', 'resident-b', 'Resident B'),
  ('20000000-0000-4000-8000-000000000003', 'resident-c', 'Resident C');

insert into complex_units (id, complex_id, building_code, unit_code) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'B1', 'U1');
insert into households (id, complex_id, complex_unit_id) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
insert into household_memberships (id, complex_id, household_id, user_id, membership_role, status, verified_at) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'primary', 'verified', now());

insert into community_posts (id, complex_id, author_user_id, kind, title, body, status, published_at, hidden_at, deleted_at) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'question', 'Published', 'body', 'published', now(), null, null),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'question', 'Pending', 'body', 'pending_review', null, null, null),
  ('60000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'question', 'Hidden', 'body', 'hidden', null, now(), null),
  ('60000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'question', 'Other complex', 'body', 'published', now(), null, null);

insert into community_comments (id, complex_id, post_id, author_user_id, body, status, published_at, hidden_at) values
  ('61000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Published comment', 'published', now(), null),
  ('61000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Pending comment', 'pending_review', null, null),
  ('61000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Hidden comment', 'hidden', null, now());

insert into community_reactions (complex_id, post_id, user_id, reaction_type) values
  ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'like'),
  ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'like'),
  ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'like');

insert into businesses (id, owner_user_id, kind, name, status) values
  ('70000000-0000-4000-8000-000000000001', null, 'shop', 'Approved', 'approved'),
  ('70000000-0000-4000-8000-000000000002', null, 'shop', 'Pending', 'pending'),
  ('70000000-0000-4000-8000-000000000003', null, 'shop', 'Other complex', 'approved');
insert into business_complex_relations (business_id, complex_id, relation_type, verification_status) values
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'neighbor', 'verified'),
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'neighbor', 'verified'),
  ('70000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'neighbor', 'verified');
insert into bookmarks (user_id, business_id) values
  ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000003');

insert into conversations (id, complex_id, type, resident_pair_key, created_at, updated_at) values
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'resident', '20000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z'),
  ('80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'resident', '20000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000003', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z');
insert into conversation_members (conversation_id, user_id, last_read_at) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2026-01-02T00:00:00Z'),
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', null),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', null),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', null);
insert into messages (conversation_id, sender_user_id, body, created_at) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'old', '2026-01-01T12:00:00Z'),
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'new one', '2026-01-02T12:00:00Z'),
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'new two', '2026-01-03T12:00:00Z'),
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'own message', '2026-01-04T12:00:00Z'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'other complex unread', '2026-01-04T12:00:00Z');

do $$
declare
  posts integer;
  comments integer;
  received integer;
  saved integer;
  unread integer;
begin
  select count(*) into posts from community_posts p
    where p.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
      and p.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
      and p.status in ('published','pending_review');
  select count(*) into comments from community_comments c
    where c.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
      and c.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
      and c.status in ('published','pending_review');
  select count(*) into received
    from community_reactions r join community_posts p on p.id = r.post_id and p.complex_id = r.complex_id
    where p.author_user_id = '20000000-0000-4000-8000-000000000001'::uuid
      and p.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
      and p.status = 'published'
      and r.user_id <> '20000000-0000-4000-8000-000000000001'::uuid;
  select count(*) into saved
    from bookmarks bm
    join businesses b on b.id = bm.business_id and b.status = 'approved'
    join business_complex_relations rel on rel.business_id = b.id
      and rel.complex_id = '10000000-0000-4000-8000-000000000001'::uuid
      and rel.verification_status = 'verified'
    where bm.user_id = '20000000-0000-4000-8000-000000000001'::uuid;
  select count(*) into unread
    from conversation_members mine
    join conversations conv on conv.id = mine.conversation_id
      and conv.complex_id = '10000000-0000-4000-8000-000000000001'::uuid and conv.type = 'resident'
    join messages m on m.conversation_id = conv.id
    where mine.user_id = '20000000-0000-4000-8000-000000000001'::uuid
      and m.sender_user_id <> '20000000-0000-4000-8000-000000000001'::uuid
      and m.deleted_at is null
      and (mine.last_read_at is null or m.created_at > mine.last_read_at);

  if posts <> 2 then raise exception 'post_count expected 2 got %', posts; end if;
  if comments <> 2 then raise exception 'comment_count expected 2 got %', comments; end if;
  if received <> 1 then raise exception 'received_reaction_count expected 1 got %', received; end if;
  if saved <> 1 then raise exception 'saved_business_count expected 1 got %', saved; end if;
  if unread <> 2 then raise exception 'unread_message_count expected 2 got %', unread; end if;
end $$;
SQL

echo "PASS resident summary PostgreSQL lifecycle: current own activity, published received reactions, valid complex bookmarks, canonical unread semantics"
