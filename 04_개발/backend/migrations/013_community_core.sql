-- DanjiOn resident-only Community persistence v1.
-- Official/trusted complex content remains in complex_posts.
-- Runtime read/write authorization must use Household v2 + PADIEM operator scopes.

create table if not exists community_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  author_user_id uuid not null references app_users(id) on delete restrict,
  kind text not null check (kind in ('question','together','resident_story','life_report')),
  title text not null,
  body text not null,
  status text not null default 'pending_review' check (status in ('pending_review','published','hidden','deleted')),
  visibility text not null default 'verified_residents' check (visibility in ('verified_residents')),
  published_at timestamptz,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, complex_id),
  check (char_length(title) between 1 and 160),
  check (char_length(body) between 1 and 10000),
  check (status <> 'published' or published_at is not null),
  check (status <> 'hidden' or hidden_at is not null),
  check (status <> 'deleted' or deleted_at is not null)
);

create table if not exists community_comments (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  post_id uuid not null,
  author_user_id uuid not null references app_users(id) on delete restrict,
  body text not null,
  status text not null default 'pending_review' check (status in ('pending_review','published','hidden','deleted')),
  published_at timestamptz,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, complex_id),
  foreign key (post_id, complex_id)
    references community_posts(id, complex_id) on delete cascade,
  check (char_length(body) between 1 and 300),
  check (status <> 'published' or published_at is not null),
  check (status <> 'hidden' or hidden_at is not null),
  check (status <> 'deleted' or deleted_at is not null)
);

create table if not exists community_reactions (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  post_id uuid not null,
  user_id uuid not null references app_users(id) on delete cascade,
  reaction_type text not null default 'like' check (reaction_type in ('like')),
  created_at timestamptz not null default now(),
  foreign key (post_id, complex_id)
    references community_posts(id, complex_id) on delete cascade,
  unique (post_id, user_id, reaction_type)
);

create table if not exists community_reports (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  reporter_user_id uuid not null references app_users(id) on delete restrict,
  post_id uuid,
  comment_id uuid,
  reason text not null check (reason in ('abuse','threat','privacy','defamation_risk','spam','other')),
  detail text,
  status text not null default 'submitted' check (status in ('submitted','reviewing','resolved','dismissed')),
  resolved_by_user_id uuid references app_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (post_id, complex_id)
    references community_posts(id, complex_id) on delete cascade,
  foreign key (comment_id, complex_id)
    references community_comments(id, complex_id) on delete cascade,
  check ((post_id is not null)::integer + (comment_id is not null)::integer = 1),
  check (detail is null or char_length(detail) <= 1000),
  check (status not in ('resolved','dismissed') or resolved_at is not null)
);

create table if not exists community_moderation_events (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  post_id uuid,
  comment_id uuid,
  actor_kind text not null check (actor_kind in ('operator','system')),
  operator_user_id uuid references app_users(id) on delete set null,
  action text not null check (action in ('review_requested','published','hidden','restored','deleted','report_resolved','report_dismissed')),
  reason_code text,
  note text,
  created_at timestamptz not null default now(),
  foreign key (post_id, complex_id)
    references community_posts(id, complex_id) on delete cascade,
  foreign key (comment_id, complex_id)
    references community_comments(id, complex_id) on delete cascade,
  check ((post_id is not null)::integer + (comment_id is not null)::integer = 1),
  check (actor_kind <> 'operator' or operator_user_id is not null),
  check (reason_code is null or char_length(reason_code) <= 120),
  check (note is null or char_length(note) <= 1000)
);

create index if not exists idx_community_posts_feed
  on community_posts (complex_id, status, published_at desc, created_at desc);

create index if not exists idx_community_posts_author
  on community_posts (author_user_id, created_at desc);

create index if not exists idx_community_comments_post
  on community_comments (post_id, status, created_at asc);

create index if not exists idx_community_reactions_post
  on community_reactions (post_id, reaction_type, created_at desc);

create index if not exists idx_community_reports_queue
  on community_reports (complex_id, status, created_at asc);

create unique index if not exists uq_community_open_post_report_per_user
  on community_reports (reporter_user_id, post_id)
  where post_id is not null and status in ('submitted','reviewing');

create unique index if not exists uq_community_open_comment_report_per_user
  on community_reports (reporter_user_id, comment_id)
  where comment_id is not null and status in ('submitted','reviewing');

create index if not exists idx_community_moderation_target_post
  on community_moderation_events (post_id, created_at desc)
  where post_id is not null;

create index if not exists idx_community_moderation_target_comment
  on community_moderation_events (comment_id, created_at desc)
  where comment_id is not null;

drop trigger if exists trg_community_posts_updated_at on community_posts;
create trigger trg_community_posts_updated_at
  before update on community_posts
  for each row execute function set_updated_at();

drop trigger if exists trg_community_comments_updated_at on community_comments;
create trigger trg_community_comments_updated_at
  before update on community_comments
  for each row execute function set_updated_at();

drop trigger if exists trg_community_reports_updated_at on community_reports;
create trigger trg_community_reports_updated_at
  before update on community_reports
  for each row execute function set_updated_at();
