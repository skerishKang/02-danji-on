-- DanjiOn resident news v1.
-- Resident submissions and approved resident-only publications are deliberately
-- separate from public complex_posts so guest official-news routes cannot leak them.

create table if not exists resident_news_submissions (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  submitter_user_id uuid not null references app_users(id) on delete restrict,
  title text not null,
  body text not null,
  status text not null default 'submitted'
    check (status in ('submitted','reviewing','approved','rejected')),
  review_note text,
  reviewed_by_user_id uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, complex_id),
  check (char_length(title) between 1 and 160),
  check (char_length(body) between 1 and 10000),
  check (review_note is null or char_length(review_note) <= 1000),
  check (status in ('submitted','reviewing') or reviewed_at is not null)
);

create table if not exists resident_news_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  source_submission_id uuid not null,
  title text not null,
  body text not null,
  status text not null default 'published' check (status in ('published','archived')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_submission_id),
  unique (id, complex_id),
  foreign key (source_submission_id, complex_id)
    references resident_news_submissions(id, complex_id) on delete restrict,
  check (char_length(title) between 1 and 160),
  check (char_length(body) between 1 and 10000)
);

create table if not exists resident_news_review_events (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  submission_id uuid not null,
  operator_user_id uuid not null references app_users(id) on delete restrict,
  action text not null check (action in ('reviewing','approved','rejected')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (submission_id, complex_id)
    references resident_news_submissions(id, complex_id) on delete cascade,
  check (note is null or char_length(note) <= 1000)
);

create index if not exists idx_resident_news_submissions_queue
  on resident_news_submissions (complex_id, status, created_at asc);
create index if not exists idx_resident_news_submissions_submitter
  on resident_news_submissions (submitter_user_id, complex_id, created_at desc);
create index if not exists idx_resident_news_posts_feed
  on resident_news_posts (complex_id, status, published_at desc, id desc);
create index if not exists idx_resident_news_review_events_submission
  on resident_news_review_events (submission_id, created_at desc);

drop trigger if exists trg_resident_news_submissions_updated_at on resident_news_submissions;
create trigger trg_resident_news_submissions_updated_at
  before update on resident_news_submissions
  for each row execute function set_updated_at();

drop trigger if exists trg_resident_news_posts_updated_at on resident_news_posts;
create trigger trg_resident_news_posts_updated_at
  before update on resident_news_posts
  for each row execute function set_updated_at();

create or replace function notify_resident_news_publish()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'published' then
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
  )
  select distinct
    hm.user_id,
    new.complex_id,
    'resident_news',
    null::uuid,
    'resident_news',
    new.id,
    'resident-news:' || new.id::text,
    '새 주민소식이 등록되었습니다'
  from household_memberships hm
  join households h
    on h.id = hm.household_id
   and h.complex_id = hm.complex_id
   and h.status = 'active'
  join complex_units cu
    on cu.id = h.complex_unit_id
   and cu.complex_id = h.complex_id
   and cu.status = 'active'
  where hm.complex_id = new.complex_id
    and hm.status = 'verified'
  on conflict (user_id, source_event_key) where source_event_key is not null do nothing;

  return new;
end;
$$;

drop trigger if exists trg_resident_news_publish_notification on resident_news_posts;
create trigger trg_resident_news_publish_notification
  after insert on resident_news_posts
  for each row execute function notify_resident_news_publish();
