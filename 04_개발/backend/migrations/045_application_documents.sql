-- GAP-5 Phase-A: private application document registry
-- storage kind: application-document
-- visibility: private
-- document_kind: operation_proof, other_evidence, additional_reference

alter table business_image_objects add column if not exists kind text default 'business-image';

create table if not exists business_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references business_applications(id) on delete cascade,
  object_key text not null,
  document_kind text not null check (document_kind in ('operation_proof', 'other_evidence', 'additional_reference')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists business_application_documents_object_key_uniq
  on business_application_documents(object_key);

create index if not exists business_application_documents_application_id_idx
  on business_application_documents(application_id);
