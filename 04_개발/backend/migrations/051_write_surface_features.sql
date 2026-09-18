-- Branch preview: complete resident write-surface persistence for the pilot.
-- No production authority is implied by this migration. It is exercised in isolated QA first.

alter table community_posts
  add column if not exists question_category text,
  add column if not exists allow_direct_messages boolean not null default false,
  add column if not exists together_type text,
  add column if not exists structured_data jsonb not null default '{}'::jsonb;

alter table community_posts
  drop constraint if exists community_posts_question_category_check;
alter table community_posts
  add constraint community_posts_question_category_check
  check (question_category is null or question_category in ('living','facility','recommendation','other'));

alter table community_posts
  drop constraint if exists community_posts_together_type_check;
alter table community_posts
  add constraint community_posts_together_type_check
  check (together_type is null or together_type in ('walk','hobby','parenting','group_buy'));

alter table community_posts
  drop constraint if exists community_posts_structured_data_object_check;
alter table community_posts
  add constraint community_posts_structured_data_object_check
  check (jsonb_typeof(structured_data) = 'object');

create table if not exists community_post_attachments (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  post_id uuid not null,
  uploader_user_id uuid not null references app_users(id) on delete cascade,
  sort_order integer not null check (sort_order between 0 and 2),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size between 1 and 1048576),
  content_bytes bytea not null,
  created_at timestamptz not null default now(),
  foreign key (post_id, complex_id)
    references community_posts(id, complex_id) on delete cascade,
  unique (post_id, sort_order)
);

create index if not exists idx_community_post_attachments_post
  on community_post_attachments(post_id, sort_order);

create table if not exists inquiry_attachments (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references inquiries(id) on delete cascade,
  uploader_user_id uuid not null references app_users(id) on delete cascade,
  sort_order integer not null check (sort_order between 0 and 2),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size between 1 and 1048576),
  content_bytes bytea not null,
  created_at timestamptz not null default now(),
  unique (inquiry_id, sort_order)
);

create index if not exists idx_inquiry_attachments_inquiry
  on inquiry_attachments(inquiry_id, sort_order);

create table if not exists resident_news_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references resident_news_submissions(id) on delete cascade,
  uploader_user_id uuid not null references app_users(id) on delete cascade,
  sort_order integer not null check (sort_order between 0 and 2),
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text not null,
  byte_size integer not null check (byte_size between 1 and 5242880),
  content_bytes bytea not null,
  created_at timestamptz not null default now(),
  unique (submission_id, sort_order)
);

create index if not exists idx_resident_news_submission_attachments_submission
  on resident_news_submission_attachments(submission_id, sort_order);

comment on table community_post_attachments is
  'Pilot resident-post images, max 3 x 1 MiB, stored in Neon until media-store promotion is approved.';
comment on table inquiry_attachments is
  'Private inquiry screenshots, max 3 x 1 MiB, readable only by owner/operator routes.';
comment on table resident_news_submission_attachments is
  'Private resident-news submission materials, max 3 x 5 MiB, reviewed by operators before publication.';
