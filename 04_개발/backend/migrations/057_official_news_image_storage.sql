-- DanjiOn official apartment-news public image storage.
-- Issue #844 (OWNER=LOCAL2).
--
-- Adds the third storage kind to the shared lifecycle registry that 019/020/021/022/045/054
-- already generalized for business-image (public) and application-document (private).
--
-- Additive only:
--   * business-image and application-document rows keep their existing constraints/semantics
--   * no Drive folder binding is introduced (Amendment A): official-news-image bytes live in the
--     existing public business folder and are separated logically by kind, objectKey namespace
--     and Drive appProperties (danjionKind=official-news-image, danjionVisibility=public)
--   * objectKey namespace: gdrive/public/official-news-image/<fileId>

-- 1. Extend the kind guard. 054 named this guard for the application-document lane; it is the
--    registry-wide kind allow-list, so the new public kind is added here.
alter table business_image_objects
  drop constraint if exists chk_application_document_object_kind;

alter table business_image_objects
  add constraint chk_application_document_object_kind
  check (kind in ('business-image', 'application-document', 'official-news-image'));

-- 2. Extend the namespace guard so an official-news-image key can never be written with a
--    business-image or application-document prefix (and vice versa).
alter table business_image_objects
  drop constraint if exists chk_business_image_object_namespace;

alter table business_image_objects
  add constraint chk_business_image_object_namespace
  check (
    (kind = 'business-image' and object_key like 'gdrive/public/business-image/%')
    or
    (kind = 'application-document' and object_key like 'gdrive/private/application-document/%')
    or
    (kind = 'official-news-image' and object_key like 'gdrive/public/official-news-image/%')
  );

-- 3. Kind-scoped upload idempotency lane. Callers reusing the same Idempotency-Key across kinds
--    must not collide (same rule 054 applied to the application-document lane).
create unique index if not exists uq_official_news_image_upload_idempotency
  on business_image_objects (uploader_user_id, upload_idempotency_key)
  where kind = 'official-news-image' and upload_idempotency_key is not null;

-- 4. Pending-row lookup used by same-key replay and reconciliation on the official-news lane.
create index if not exists idx_official_news_image_upload_pending
  on business_image_objects (uploader_user_id, complex_id, state, updated_at)
  where kind = 'official-news-image' and state = 'upload_pending';

comment on table business_image_objects is
  'Authoritative lifecycle registry for DanjiOn public business-image, private application-document and public official-news-image object keys. upload_pending durably reserves an exact Drive id before binary persistence; only active references may be acquired.';

comment on column business_image_objects.kind is
  'Storage kind lane: business-image (public), application-document (private), official-news-image (public apartment-news attachment).';

comment on index uq_official_news_image_upload_idempotency is
  'Official-news-image idempotency scope: (uploader, Idempotency-Key) binds to exactly one durable public official-news image object key.';

comment on index idx_official_news_image_upload_pending is
  'Pending official-news-image reservations awaiting Drive confirmation or reconciliation, scoped to the uploader and complex.';
