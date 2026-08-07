-- DanjiOn admin workflow additions
-- Keeps application review and the approved business linked for idempotent approval.

alter table business_applications
  add column if not exists approved_business_id uuid references businesses(id) on delete set null;

create unique index if not exists uq_business_applications_approved_business
  on business_applications(approved_business_id)
  where approved_business_id is not null;
