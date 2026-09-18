-- DanjiOn Community post category (말머리) v1 for #767 (#762 owner live QA round 2).
--
-- Bounded, additive and idempotent:
--   - one nullable text column on community_posts. Existing rows, and every kind
--     without a canonical category allowlist (greeting / resident_story), stay
--     NULL, so no backfill and no data rewrite is required.
--   - one named check bounds the stored length only. The per-kind allowlist stays
--     server-authoritative in src/community-resident-v1.ts; the database must not
--     duplicate a product list that will grow.
--   - 013 remains the historical authority and is untouched.
alter table community_posts add column if not exists category text;

alter table community_posts drop constraint if exists community_posts_category_check;

alter table community_posts
  add constraint community_posts_category_check
  check (category is null or char_length(category) between 1 and 40);
