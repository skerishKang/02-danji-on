-- Canonical community greeting post kind for #329 C2 (#348, CENTRAL contract).
--
-- The join-greeting surface (page 14) gets a first-class kind instead of any
-- coercion into question/together/resident_story/life_report. Purely additive
-- and bounded:
--   - no DROP TABLE / TRUNCATE / DELETE, no data rewrite, no index churn
--   - migration 013 is historical authority and stays untouched
--   - the legacy anonymous kind check is dropped by its deterministic
--     auto-generated name and replaced by one named check that includes
--     'greeting'; both names are dropped if present before the single add,
--     so reruns are exact no-ops
alter table community_posts drop constraint if exists community_posts_kind_check;
alter table community_posts drop constraint if exists community_posts_kind_check_c2;
alter table community_posts add constraint community_posts_kind_check_c2 check (kind in ('question','together','resident_story','life_report','greeting'));
