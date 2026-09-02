#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

psql_cmd=(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q)

# Message/notification migrations only need the initial identity/complex/business
# schema plus the set_updated_at() helper. This runs in a disposable PostgreSQL DB.
"${psql_cmd[@]}" -f migrations/001_initial_schema.sql
"${psql_cmd[@]}" -f migrations/024_resident_messages.sql
"${psql_cmd[@]}" -f migrations/025_resident_notifications.sql

"${psql_cmd[@]}" <<'SQL'
insert into complexes (id, slug, name, status) values
  ('10000000-0000-4000-8000-000000000001', 'complex-1', 'Complex One', 'active');

insert into app_users (id, auth_user_id, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'sub-A', 'A-neighbor'),
  ('20000000-0000-4000-8000-000000000002', 'sub-B', 'B-neighbor');

insert into conversations (id, complex_id, type, resident_pair_key) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'resident',
  '20000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000002'
);

insert into conversation_members (conversation_id, user_id, last_read_at) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', now()),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', null);

insert into messages (id, conversation_id, sender_user_id, body) values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'PRIVATE BODY MUST NOT BE COPIED TO NOTIFICATIONS'
);

do $$
declare
  notification_count integer;
  recipient uuid;
  scoped_complex uuid;
  actor uuid;
  kind text;
  resource_kind text;
  resource uuid;
  event_key text;
  stored_title text;
begin
  select count(*) into notification_count from notifications;
  if notification_count <> 1 then
    raise exception 'expected exactly one notification, got %', notification_count;
  end if;

  select user_id, complex_id, actor_user_id, type, resource_type, resource_id, source_event_key, title
  into recipient, scoped_complex, actor, kind, resource_kind, resource, event_key, stored_title
  from notifications
  limit 1;

  if recipient <> '20000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'wrong recipient: %', recipient;
  end if;
  if scoped_complex <> '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'wrong complex scope: %', scoped_complex;
  end if;
  if actor <> '20000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'wrong actor: %', actor;
  end if;
  if kind <> 'message' or resource_kind <> 'conversation' then
    raise exception 'wrong notification linkage: % / %', kind, resource_kind;
  end if;
  if resource <> '30000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'wrong resource id: %', resource;
  end if;
  if event_key <> 'message:40000000-0000-4000-8000-000000000001' then
    raise exception 'wrong source event key: %', event_key;
  end if;
  if stored_title = 'PRIVATE BODY MUST NOT BE COPIED TO NOTIFICATIONS' then
    raise exception 'message body leaked into notification title';
  end if;
end $$;

-- A second message must create one additional independent notification.
insert into messages (id, conversation_id, sender_user_id, body) values (
  '40000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'reply'
);

do $$
declare
  notification_count integer;
  a_count integer;
  b_count integer;
begin
  select count(*) into notification_count from notifications;
  if notification_count <> 2 then
    raise exception 'expected two notifications after two messages, got %', notification_count;
  end if;

  select count(*) into a_count
  from notifications
  where user_id = '20000000-0000-4000-8000-000000000001'::uuid;
  select count(*) into b_count
  from notifications
  where user_id = '20000000-0000-4000-8000-000000000002'::uuid;

  if a_count <> 1 or b_count <> 1 then
    raise exception 'bidirectional recipient routing failed: A=% B=%', a_count, b_count;
  end if;
end $$;
SQL

echo "PASS resident notification PostgreSQL lifecycle: migrations 001+024+025, message trigger, recipient routing, complex scope, resource linkage, no body copy"
