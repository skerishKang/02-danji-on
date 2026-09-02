-- DanjiOn Community notification producers v1.
-- Durable in-app notifications are emitted from canonical DB state transitions so
-- review-mode content never alerts recipients before publication.

create or replace function notify_community_comment_published()
returns trigger
language plpgsql
as $$
declare
  recipient_user_id uuid;
  notification_type text;
  notification_title text;
begin
  if new.status <> 'published' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;
  end if;

  if new.parent_comment_id is null then
    select p.author_user_id
      into recipient_user_id
    from community_posts p
    where p.id = new.post_id
      and p.complex_id = new.complex_id
      and p.status = 'published'
    limit 1;

    notification_type := 'community_comment';
    notification_title := '내 글에 새 댓글이 달렸습니다';
  else
    select parent.author_user_id
      into recipient_user_id
    from community_comments parent
    join community_posts p
      on p.id = parent.post_id
     and p.complex_id = parent.complex_id
    where parent.id = new.parent_comment_id
      and parent.post_id = new.post_id
      and parent.complex_id = new.complex_id
      and parent.status = 'published'
      and p.status = 'published'
    limit 1;

    notification_type := 'community_reply';
    notification_title := '내 댓글에 새 답글이 달렸습니다';
  end if;

  if recipient_user_id is null or recipient_user_id = new.author_user_id then
    return new;
  end if;

  insert into notifications (
    user_id,
    complex_id,
    type,
    actor_user_id,
    resource_type,
    resource_id,
    source_event_key,
    title
  ) values (
    recipient_user_id,
    new.complex_id,
    notification_type,
    new.author_user_id,
    'community_post',
    new.post_id,
    'community-comment:' || new.id::text,
    notification_title
  )
  on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_notify_community_comment_published on community_comments;
create trigger trg_notify_community_comment_published
  after insert or update of status on community_comments
  for each row execute function notify_community_comment_published();

create or replace function notify_community_reaction_insert()
returns trigger
language plpgsql
as $$
declare
  recipient_user_id uuid;
begin
  select p.author_user_id
    into recipient_user_id
  from community_posts p
  where p.id = new.post_id
    and p.complex_id = new.complex_id
    and p.status = 'published'
  limit 1;

  if recipient_user_id is null or recipient_user_id = new.user_id then
    return new;
  end if;

  insert into notifications (
    user_id,
    complex_id,
    type,
    actor_user_id,
    resource_type,
    resource_id,
    source_event_key,
    title
  ) values (
    recipient_user_id,
    new.complex_id,
    'community_reaction',
    new.user_id,
    'community_post',
    new.post_id,
    'community-reaction:' || new.id::text,
    '내 글에 새 공감이 도착했습니다'
  )
  on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_notify_community_reaction_insert on community_reactions;
create trigger trg_notify_community_reaction_insert
  after insert on community_reactions
  for each row execute function notify_community_reaction_insert();
