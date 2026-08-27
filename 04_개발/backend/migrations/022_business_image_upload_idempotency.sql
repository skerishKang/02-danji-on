-- DanjiOn business-image upload idempotency metadata.
-- Extends the durable business-image lifecycle registry only.

alter table business_image_objects
  add column if not exists upload_idempotency_key text,
  add column if not exists upload_request_fingerprint text;

alter table business_image_objects
  drop constraint if exists chk_business_image_upload_idempotency_pair;

alter table business_image_objects
  add constraint chk_business_image_upload_idempotency_pair
  check (
    (upload_idempotency_key is null and upload_request_fingerprint is null)
    or
    (upload_idempotency_key is not null and upload_request_fingerprint is not null)
  );

alter table business_image_objects
  drop constraint if exists chk_business_image_upload_idempotency_key;

alter table business_image_objects
  add constraint chk_business_image_upload_idempotency_key
  check (
    upload_idempotency_key is null
    or (
      char_length(upload_idempotency_key) between 8 and 80
      and upload_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  );

alter table business_image_objects
  drop constraint if exists chk_business_image_upload_request_fingerprint;

alter table business_image_objects
  add constraint chk_business_image_upload_request_fingerprint
  check (
    upload_request_fingerprint is null
    or upload_request_fingerprint ~ '^[0-9a-f]{64}$'
  );

create unique index if not exists uq_business_image_upload_idempotency
  on business_image_objects (uploader_user_id, upload_idempotency_key)
  where upload_idempotency_key is not null;

comment on column business_image_objects.upload_idempotency_key is
  'Optional caller-supplied stable key binding one uploader upload attempt family to one durable business-image object key.';
comment on column business_image_objects.upload_request_fingerprint is
  'SHA-256 fingerprint binding an upload idempotency key to complex, filename, MIME, size and file content.';
