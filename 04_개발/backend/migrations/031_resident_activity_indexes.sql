-- DanjiOn resident activity read-model support.
-- Activity remains derived from canonical domain tables; only missing access-path indexes are added.

create index if not exists idx_community_comments_activity_author
  on community_comments (author_user_id, complex_id, created_at desc, id desc);

create index if not exists idx_community_reactions_activity_user
  on community_reactions (user_id, complex_id, created_at desc, id desc);
