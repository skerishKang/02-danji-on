-- DanjiOn business reviews v1.
-- Text-only resident reviews with one canonical business-owner reply per review.

create table if not exists business_reviews (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  business_id uuid not null,
  author_user_id uuid not null references app_users(id) on delete cascade,
  body text not null,
  status text not null default 'active' check (status in ('active','hidden','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, complex_id)
    references business_complex_relations(business_id, complex_id) on delete cascade,
  check (char_length(body) between 1 and 2000),
  unique (id, business_id, complex_id)
);

create index if not exists idx_business_reviews_business_created
  on business_reviews (complex_id, business_id, created_at desc, id desc)
  where status = 'active';

create index if not exists idx_business_reviews_author_created
  on business_reviews (author_user_id, created_at desc);

create table if not exists business_review_replies (
  review_id uuid primary key,
  business_id uuid not null,
  complex_id uuid not null,
  owner_user_id uuid not null references app_users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (review_id, business_id, complex_id)
    references business_reviews(id, business_id, complex_id) on delete cascade,
  check (char_length(body) between 1 and 2000)
);

create or replace function enforce_business_review_reply_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from businesses b
    where b.id = new.business_id
      and b.owner_user_id = new.owner_user_id
      and b.status = 'approved'
  ) then
    raise exception 'business review reply owner mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_business_review_reply_owner on business_review_replies;
create trigger trg_business_review_reply_owner
  before insert or update on business_review_replies
  for each row execute function enforce_business_review_reply_owner();

drop trigger if exists trg_business_reviews_updated_at on business_reviews;
create trigger trg_business_reviews_updated_at
  before update on business_reviews
  for each row execute function set_updated_at();

drop trigger if exists trg_business_review_replies_updated_at on business_review_replies;
create trigger trg_business_review_replies_updated_at
  before update on business_review_replies
  for each row execute function set_updated_at();
