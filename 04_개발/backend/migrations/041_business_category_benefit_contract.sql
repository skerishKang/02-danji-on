-- #278: sibling final v3 business category and benefit contracts.
-- PRODUCT_AUTHORITY = sibling final v3 frontend @
--   a2e856de522f77793ced0718cf58ab4b2d210732
-- The frontend expresses businesses with multiple category tokens
-- (로드힐 꽃작업실 = cafe + food, 우리동네 자동차정비 = car + home) and
-- benefits carrying a display value (예: '10%', '면제') and a product code
-- (예: 'DANJION · F010'). The backend adapts; the frontend is never reduced.
--
-- This migration is purely additive:
--  - no DROP / TRUNCATE / mass UPDATE / DELETE
--  - businesses.category_id is preserved as the primary-category backward
--    compatibility column (never dropped here)

-- 1) MULTI_CATEGORY: normalized business <-> category join.
--    businesses.category_id remains the canonical primary category;
--    this table records the full category token set for discovery.
create table if not exists business_category_relations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid not null references business_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (business_id, category_id)
);

create index if not exists idx_business_category_relations_business
  on business_category_relations (business_id);

create index if not exists idx_business_category_relations_category
  on business_category_relations (category_id, business_id);

comment on table business_category_relations is
  'Sibling v3 multi-category contract: a business may hold several category tokens (cafe+food, car+home). businesses.category_id stays the primary category for backward compatibility.';

-- 2) BENEFIT_VALUE: product display value exactly as the frontend authors it
--    ('10%', '면제', '무료', '할인', '공임할인', '촬영할인', '예약혜택').
--    Stored verbatim as product data; no settlement/discount logic is implied.
alter table benefits add column if not exists value_text text;

comment on column benefits.value_text is
  'Sibling v3 benefit display value, verbatim product copy (예: 10%, 면제, 무료). Not a settlement calculation.';

-- 3) BENEFIT_CODE: sibling v3 benefit code (예: DANJION · F010).
--    Deliberately NOT globally unique: codes are product copy scoped by
--    complex/benefit lifecycle; repo semantics do not prove global uniqueness
--    and coupon redemption semantics must not be inferred from this field.
alter table benefits add column if not exists code text;

create index if not exists idx_benefits_code on benefits (code);

comment on column benefits.code is
  'Sibling v3 benefit product code (예: DANJION · F010). Non-unique by design; no redemption semantics implied.';

-- DOWN:
-- drop index if exists idx_benefits_code;
-- alter table benefits drop column if exists code;
-- alter table benefits drop column if exists value_text;
-- drop index if exists idx_business_category_relations_category;
-- drop index if exists idx_business_category_relations_business;
-- drop table if exists business_category_relations;
