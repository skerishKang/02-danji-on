-- GAP-4: application multi-photo persistence
-- PRODUCT_AUTHORITY = frontend/25A_신청제보.html (max 3 photos)
-- This migration adds business_application_photos table to support 0..3 photos per application.
-- representative_image_object_key is preserved for backward compatibility (first photo mirror).

create table if not exists business_application_photos (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references business_applications(id) on delete cascade,
  object_key text not null check (object_key like 'gdrive/public/business-image/%'),
  sort_order integer not null check (sort_order between 0 and 2),
  created_at timestamptz not null default now(),
  unique (application_id, sort_order),
  unique (application_id, object_key),
  unique (object_key)
);

create index if not exists idx_business_application_photos_application
  on business_application_photos (application_id);

create index if not exists idx_business_application_photos_object_key
  on business_application_photos (object_key);

comment on table business_application_photos is
  'GAP-4 multi-photo persistence: 0..3 photos per business application. First photo (sort_order=0) mirrors representative_image_object_key.';

-- BACKWARD COMPATIBILITY: Existing applications with representative_image_object_key remain valid.
-- New applications should:
--  - store photos in business_application_photos
--  - mirror first photo to representative_image_object_key
-- No backfill in this migration: legacy representative-only rows stay valid;
-- new writes populate both columns. A deterministic backfill (if needed) ships separately.
--
-- DOWN:
-- drop index if exists idx_business_application_photos_object_key;
-- drop index if exists idx_business_application_photos_application;
-- drop table if exists business_application_photos;
