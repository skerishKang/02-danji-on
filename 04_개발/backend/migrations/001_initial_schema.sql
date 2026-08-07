-- DanjiOn initial application schema
-- Auth identity is supplied by Neon Auth; product authorization remains in app tables.

create extension if not exists pgcrypto;

create table if not exists complexes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text,
  status text not null default 'active' check (status in ('active','pilot','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id text not null unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists complex_memberships (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'resident' check (role in ('resident','business_owner','manager','admin')),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected','suspended')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (complex_id, user_id)
);

-- Sensitive residence proof is isolated from normal membership/profile reads.
create table if not exists resident_verifications (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references complex_memberships(id) on delete cascade,
  building_code text,
  unit_code text,
  method text not null default 'manual',
  evidence_object_key text,
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  reviewed_by uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists business_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references app_users(id) on delete set null,
  category_id uuid references business_categories(id) on delete set null,
  kind text not null default 'service' check (kind in ('shop','service')),
  name text not null,
  summary text not null default '',
  description text not null default '',
  price_text text,
  service_area text,
  availability_text text,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Relationship is relative to the apartment complex being viewed.
-- One business may be a resident business for one complex and a neighborhood business for another.
create table if not exists business_complex_relations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  complex_id uuid not null references complexes(id) on delete cascade,
  relation_type text not null check (relation_type in ('resident','resident_family','neighbor','local')),
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  priority smallint not null default 100,
  verified_by uuid references app_users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, complex_id)
);

create table if not exists business_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  object_key text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Contact details are deliberately split from the public business record.
create table if not exists business_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  contact_type text not null check (contact_type in ('phone','sms','kakao','url')),
  contact_value text not null,
  visibility text not null default 'verified_residents' check (visibility in ('public','verified_residents','owner_only')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists benefits (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  title text not null,
  description text not null default '',
  conditions text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('draft','active','expired','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bookmarks (
  user_id uuid not null references app_users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table if not exists complex_posts (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  author_user_id uuid references app_users(id) on delete set null,
  source_name text not null,
  category text not null,
  title text not null,
  body text not null,
  attachment_object_key text,
  status text not null default 'published' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_applications (
  id uuid primary key default gen_random_uuid(),
  complex_id uuid not null references complexes(id) on delete cascade,
  applicant_user_id uuid not null references app_users(id) on delete cascade,
  relation_type text not null check (relation_type in ('resident','resident_family','neighbor','local')),
  business_name text not null,
  category_name text not null,
  service_summary text not null,
  price_text text,
  contact_method text,
  service_area text,
  benefit_text text,
  availability_text text,
  representative_image_object_key text,
  status text not null default 'pending' check (status in ('draft','pending','changes_requested','approved','rejected')),
  review_note text,
  reviewed_by uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memberships_user on complex_memberships(user_id);
create index if not exists idx_memberships_complex_status on complex_memberships(complex_id, verification_status);
create index if not exists idx_businesses_category_status on businesses(category_id, status);
create index if not exists idx_business_rel_complex_priority on business_complex_relations(complex_id, verification_status, priority);
create index if not exists idx_benefits_complex_status on benefits(complex_id, status);
create index if not exists idx_posts_complex_published on complex_posts(complex_id, published_at desc);
create index if not exists idx_applications_complex_status on business_applications(complex_id, status, created_at desc);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_complexes_updated_at') then
    create trigger trg_complexes_updated_at before update on complexes for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_app_users_updated_at') then
    create trigger trg_app_users_updated_at before update on app_users for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_memberships_updated_at') then
    create trigger trg_memberships_updated_at before update on complex_memberships for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_businesses_updated_at') then
    create trigger trg_businesses_updated_at before update on businesses for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_benefits_updated_at') then
    create trigger trg_benefits_updated_at before update on benefits for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_posts_updated_at') then
    create trigger trg_posts_updated_at before update on complex_posts for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_applications_updated_at') then
    create trigger trg_applications_updated_at before update on business_applications for each row execute function set_updated_at();
  end if;
end $$;
