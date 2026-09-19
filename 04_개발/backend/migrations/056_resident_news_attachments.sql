-- DanjiOn resident-news private submission attachments.
-- Issue #795.
--
-- Binary storage authority is not duplicated. Resident-news attachments reuse
-- the existing private application-document upload/lifecycle contract from
-- #766/#783. This table only binds an active server-issued private object key
-- to its resident-news submission.
--
-- Attachments remain source/review material. Approval does not copy them into
-- resident_news_posts and therefore does not make private bytes public.

create table if not exists resident_news_submission_attachments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  complex_id uuid not null references complexes(id) on delete cascade,
  object_key text not null references business_image_objects(object_key) on delete restrict,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (object_key),
  unique (submission_id, sort_order),
  foreign key (submission_id, complex_id)
    references resident_news_submissions(id, complex_id) on delete cascade,
  check (sort_order between 0 and 2),
  check (object_key like 'gdrive/private/application-document/%')
);

create index if not exists idx_resident_news_submission_attachments_submission
  on resident_news_submission_attachments (submission_id, sort_order);

comment on table resident_news_submission_attachments is
  'Private 0..3 attachment references for resident-news source submissions. Bytes stay on the canonical private application-document Drive lane and are never copied into published resident-news rows.';
