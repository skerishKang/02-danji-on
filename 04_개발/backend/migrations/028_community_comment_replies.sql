-- DanjiOn Community comment replies v1.
-- Replies reuse community_comments so existing reports/moderation stay canonical.

alter table community_comments
  add column if not exists parent_comment_id uuid;

create unique index if not exists uq_community_comments_id_post_complex
  on community_comments (id, post_id, complex_id);

alter table community_comments
  drop constraint if exists fk_community_comments_parent_same_post;

alter table community_comments
  add constraint fk_community_comments_parent_same_post
  foreign key (parent_comment_id, post_id, complex_id)
  references community_comments(id, post_id, complex_id)
  on delete cascade;

alter table community_comments
  drop constraint if exists chk_community_comment_not_self_parent;

alter table community_comments
  add constraint chk_community_comment_not_self_parent
  check (parent_comment_id is null or parent_comment_id <> id);

create index if not exists idx_community_comments_parent_created
  on community_comments (parent_comment_id, status, created_at asc)
  where parent_comment_id is not null;
