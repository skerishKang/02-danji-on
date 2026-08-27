-- DanjiOn business-image pre-upload reservation lifecycle.
-- Extends migration 019 without changing resident-evidence policy.

alter table business_image_objects
  drop constraint if exists chk_business_image_object_state;

alter table business_image_objects
  add constraint chk_business_image_object_state
  check (state in ('upload_pending', 'active', 'delete_pending', 'retired'));

alter table business_image_objects
  drop constraint if exists chk_business_image_object_lifecycle_timestamps;

alter table business_image_objects
  add constraint chk_business_image_object_lifecycle_timestamps
  check (
    (state = 'upload_pending' and delete_requested_at is null and retired_at is null)
    or
    (state = 'active' and delete_requested_at is null and retired_at is null)
    or
    (state = 'delete_pending' and delete_requested_at is not null and retired_at is null)
    or
    (state = 'retired' and delete_requested_at is not null and retired_at is not null)
  );

comment on table business_image_objects is
  'Authoritative lifecycle registry for DanjiOn public business-image object keys. upload_pending durably reserves an exact Drive id before binary persistence; only active references may be acquired.';

comment on column business_image_objects.state is
  'Lifecycle state: upload_pending -> active -> delete_pending -> retired. Only active may acquire product references.';