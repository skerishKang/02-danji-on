-- DanjiOn non-owner shop recommendation lane.
-- A resident may recommend a neighbor/family/local shop without becoming its owner.

create table if not exists shop_recommendations (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  reporter_user_id uuid not null references app_users(id) on delete restrict,
  relation_type text not null check (relation_type in ('resident_family','neighbor','local')),
  business_name text not null,
  category_name text not null,
  service_summary text not null,
  service_area text,
  reporter_note text,
  status text not null default 'pending' check (status in ('pending','changes_requested','approved','rejected')),
  review_note text,
  reviewed_by uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  approved_business_id uuid references businesses(id) on delete set null deferrable initially deferred,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(business_name) between 1 and 160),
  check (char_length(category_name) between 1 and 120),
  check (char_length(service_summary) between 1 and 1000),
  check (service_area is null or char_length(service_area) <= 300),
  check (reporter_note is null or char_length(reporter_note) <= 1000),
  check (review_note is null or char_length(review_note) <= 1000),
  check (status = 'pending' or reviewed_at is not null),
  check (status <> 'approved' or approved_business_id is not null)
);

create index if not exists idx_shop_recommendations_reporter
  on shop_recommendations (reporter_user_id, created_at desc);

create index if not exists idx_shop_recommendations_review_queue
  on shop_recommendations (complex_id, status, created_at asc);

drop trigger if exists trg_shop_recommendations_updated_at on shop_recommendations;
create trigger trg_shop_recommendations_updated_at
  before update on shop_recommendations
  for each row execute function set_updated_at();
