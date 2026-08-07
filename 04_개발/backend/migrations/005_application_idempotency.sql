-- DanjiOn business application idempotency.
-- A client-generated key may be reused only by the same applicant for one logical submission.

alter table business_applications
  add column if not exists submission_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_application_submission_key_length') then
    alter table business_applications
      add constraint chk_application_submission_key_length
      check (submission_key is null or char_length(submission_key) between 8 and 80);
  end if;
end $$;

create unique index if not exists uq_business_application_submission_key
  on business_applications (applicant_user_id, submission_key)
  where submission_key is not null;
