-- DanjiOn resident review comments v1 (GAP-1, parent #278).
-- Additive only: new table business_review_comments for resident comments
-- under a business review. This is a SEPARATE resource from the canonical
-- single business-owner reply (business_review_replies, migration 027).
--
-- PRODUCT_AUTHORITY:
--   frontend/01_이웃가게_발견_v3.html
--   review item -> resident comment list (resident badge) +
--   "댓글 달기" toggle + textarea maxlength=500 + "등록".
--   Canonical HTML is NOT changed by this slice; the backend adapts.
--   Comment body limit is therefore 1..500 chars (reviews stay 1..2000).
--
-- DESIGN:
--   - One row per resident comment (many per review), unlike the single
--     owner reply row per review (business_review_replies PK review_id).
--   - Tenant/business/review consistency is DB-bound:
--     FK (review_id, business_id, complex_id) references
--     business_reviews(id, business_id, complex_id) on delete cascade,
--     which itself is bound to business_complex_relations (027).
--   - Soft-delete lifecycle mirrors business_reviews:
--     status in ('active','hidden','deleted'), default 'active'.
--   - No PII columns on this table; author presentation metadata
--     (display_name/avatar_url) is joined from app_users at read time.
--   - Existing 027 objects are NOT altered here (no ALTER/DROP on
--     business_reviews or business_review_replies).

create table if not exists business_review_comments (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  business_id uuid not null,
  review_id uuid not null,
  author_user_id uuid not null references app_users(id) on delete cascade,
  body text not null,
  status text not null default 'active' check (status in ('active','hidden','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (review_id, business_id, complex_id)
    references business_reviews(id, business_id, complex_id) on delete cascade,
  check (char_length(body) between 1 and 500),
  unique (id, review_id, business_id, complex_id)
);

create index if not exists idx_business_review_comments_review_created
  on business_review_comments (complex_id, business_id, review_id, created_at asc, id asc)
  where status = 'active';

create index if not exists idx_business_review_comments_author_created
  on business_review_comments (author_user_id, created_at desc);

drop trigger if exists trg_business_review_comments_updated_at on business_review_comments;
create trigger trg_business_review_comments_updated_at
  before update on business_review_comments
  for each row execute function set_updated_at();

-- DOWN:
-- drop trigger if exists trg_business_review_comments_updated_at on business_review_comments;
-- drop index if exists idx_business_review_comments_author_created;
-- drop index if exists idx_business_review_comments_review_created;
-- drop table if exists business_review_comments;
