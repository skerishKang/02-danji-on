-- #768: 아파트소식 (complex_posts) needs two server-authoritative presentation
-- modes and a server-authoritative 공감 (like) action.
--
-- display_mode: the list may never guess "popup vs article" from title length in
-- the browser. Every post carries the mode the operator picked, and the public
-- posts API returns it so the card can choose the renderer. Legacy rows keep the
-- existing lightweight popup behaviour ('highlight'), so no backfill is needed.
--
-- complex_post_reactions: one active reaction per resident per post, mirroring the
-- community_reactions contract (013_community_core.sql): reaction_type is bounded
-- to 'like' and the uniqueness is enforced by the database, not the client.
--
-- Compatibility note: PostgreSQL has no `ALTER TABLE ... ADD CONSTRAINT IF NOT
-- EXISTS`, so the check constraint is created through an idempotent DO $$ guard
-- that checks pg_constraint by name AND target table, exactly like 003/040.

alter table complex_posts add column if not exists display_mode text not null default 'highlight';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_complex_posts_display_mode'
      and conrelid = 'complex_posts'::regclass
  ) then
    alter table complex_posts
      add constraint chk_complex_posts_display_mode
      check (display_mode in ('highlight', 'article'));
  end if;
end
$$;

comment on column complex_posts.display_mode is
  'Server-authoritative apartment-news presentation mode: highlight (popup card) | article (long-form detail).';

create table if not exists complex_post_reactions (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  post_id uuid not null references complex_posts(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  reaction_type text not null default 'like' check (reaction_type in ('like')),
  created_at timestamptz not null default now(),
  unique (post_id, user_id, reaction_type)
);

create index if not exists idx_complex_post_reactions_post
  on complex_post_reactions (post_id, reaction_type, created_at desc);

create index if not exists idx_complex_post_reactions_complex
  on complex_post_reactions (complex_id, created_at desc);

-- DOWN:
-- drop table if exists complex_post_reactions;
-- alter table complex_posts drop constraint if exists chk_complex_posts_display_mode;
-- alter table complex_posts drop column if exists display_mode;
