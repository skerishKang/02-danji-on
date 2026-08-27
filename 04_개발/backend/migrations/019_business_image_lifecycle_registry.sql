-- DanjiOn business-image lifecycle registry.
--
-- This table is the PostgreSQL serialization authority for new product
-- reference acquisition versus uploader delete intent. Google Drive remains
-- the binary/object store, but no Drive call is held inside a DB transaction.
-- Resident-verification evidence is intentionally outside this registry.

create table if not exists business_image_objects (
  object_key text primary key,
  uploader_user_id uuid not null references app_users(id),
  complex_id uuid not null references complexes(id),
  state text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delete_requested_at timestamptz,
  retired_at timestamptz,
  constraint chk_business_image_object_namespace
    check (object_key like 'gdrive/public/business-image/%'),
  constraint chk_business_image_object_state
    check (state in ('active', 'delete_pending', 'retired')),
  constraint chk_business_image_object_lifecycle_timestamps
    check (
      (state = 'active' and delete_requested_at is null and retired_at is null)
      or
      (state = 'delete_pending' and delete_requested_at is not null and retired_at is null)
      or
      (state = 'retired' and delete_requested_at is not null and retired_at is not null)
    )
);

create index if not exists idx_business_image_objects_uploader_state
  on business_image_objects (uploader_user_id, state);

create index if not exists idx_business_image_objects_complex_state
  on business_image_objects (complex_id, state);

comment on table business_image_objects is
  'Authoritative lifecycle registry for DanjiOn public business-image object keys. active references may be acquired; delete_pending and retired deny new references.';

comment on column business_image_objects.state is
  'Lifecycle state: active -> delete_pending -> retired. delete_pending is durable fail-closed state during Google Drive retirement.';