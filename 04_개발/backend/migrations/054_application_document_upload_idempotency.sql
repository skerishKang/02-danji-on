-- DanjiOn application-document upload idempotency and pending lifecycle.
--
-- Extends the shared business_image_objects registry (019/020/021/022/045)
-- for the private application-document kind only. Business-image rows keep
-- their existing constraints; this migration is additive and never widens
-- business-image semantics or private-document authz.
--
-- Issue #783 contract:
--   reservation (upload_pending, uploader+complex+Idempotency-Key scope)
--   -> exact Drive identity proof -> active
-- Failure or ambiguity must never leave a false-active private-document row.

-- 1. The registry namespace must cover both public business-image keys and
--    private application-document keys. Migration 045 added the kind column
--    and the application-document upload path writes
--    gdrive/private/application-document/<file-id> keys, but the 019
--    namespace constraint only allowed the public business-image prefix.
alter table business_image_objects
  drop constraint if exists chk_business_image_object_namespace;

alter table business_image_objects
  add constraint chk_business_image_object_namespace
  check (
    (kind = 'business-image' and object_key like 'gdrive/public/business-image/%')
    or
    (kind = 'application-document' and object_key like 'gdrive/private/application-document/%')
  );

-- 2. Kind-specific registry guards. Existing business-image check constraints
--    keep their chk_business_image_* names; application-document metadata gets
--    its own guard names so a future constraint audit cannot confuse lanes.
alter table business_image_objects
  drop constraint if exists chk_application_document_object_kind;

alter table business_image_objects
  add constraint chk_application_document_object_kind
  check (kind in ('business-image', 'application-document'));

-- 3. Idempotency lanes: separate business-image and application-document unique indexes.
-- Historical migration 022 indexed (uploader_user_id, upload_idempotency_key) without
-- filtering by kind. Scope both indexes by kind so callers using the same Idempotency-Key
-- across kinds do not conflict.
drop index if exists uq_business_image_upload_idempotency;

create unique index if not exists uq_business_image_upload_idempotency
  on business_image_objects (uploader_user_id, upload_idempotency_key)
  where kind = 'business-image' and upload_idempotency_key is not null;

drop index if exists uq_application_document_upload_idempotency;

create unique index if not exists uq_application_document_upload_idempotency
  on business_image_objects (uploader_user_id, upload_idempotency_key)
  where kind = 'application-document' and upload_idempotency_key is not null;

-- 4. Pending-row lookup used by same-key replay and reconciliation must stay
--    cheap without touching the business-image hot path.
create index if not exists idx_application_document_upload_pending
  on business_image_objects (uploader_user_id, complex_id, state, updated_at)
  where kind = 'application-document' and state = 'upload_pending';

comment on index uq_business_image_upload_idempotency is
  'Business-image idempotency scope: (uploader, Idempotency-Key) binds to exactly one durable public business-image object key.';

comment on index uq_application_document_upload_idempotency is
  'Application-document idempotency scope: (uploader, Idempotency-Key) binds to exactly one durable private object key. The reservation row also records the complex; replay with the same key but a different verified complex is a deterministic 409 scope conflict.';
