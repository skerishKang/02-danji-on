-- DanjiOn resident notification core v1.
-- Generic notification persistence with message-event production that avoids copying message bodies.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 64),
  actor_user_id uuid references app_users(id) on delete set null,
  resource_type text,
  resource_id uuid,
  source_event_key text,
  title text not null check (char_length(title) between 1 and 120),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (resource_type is null or char_length(resource_type) between 1 and 64),
  check (
    (resource_type is null and resource_id is null)
    or
    (resource_type is not null and resource_id is not null)
  ),
  check (source_event_key is null or char_length(source_event_key) between 1 and 160)
);

create unique index if not exists uq_notifications_source_event
  on notifications (user_id, source_event_key)
  where source_event_key is not null;

create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc, id desc);

create index if not exists idx_notifications_user_unread
  on notifications (user_id, created_at desc)
  where read_at is null;

create or replace function notify_resident_message_insert()
returns trigger
language plpgsql
as $$
declare
  recipient_id uuid;
begin
  select cm.user_id
  into recipient_id
  from conversation_members cm
  join conversations c on c.id = cm.conversation_id
  where cm.conversation_id = new.conversation_id
    and c.type = 'resident'
    and cm.user_id <> new.sender_user_id
  order by cm.user_id
  limit 1;

  if recipient_id is null then
    return new;
  end if;

  insert into notifications (
    user_id,
    type,
    actor_user_id,
    resource_type,
    resource_id,
    source_event_key,
    title
  ) values (
    recipient_id,
    'message',
    new.sender_user_id,
    'conversation',
    new.conversation_id,
    'message:' || new.id::text,
    '새 메시지가 도착했습니다'
  )
  on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_messages_create_notification on messages;
create trigger trg_messages_create_notification
  after insert on messages
  for each row execute function notify_resident_message_insert();
