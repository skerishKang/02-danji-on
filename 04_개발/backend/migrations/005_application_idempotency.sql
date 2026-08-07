-- DanjiOn business application idempotency.
-- A client-generated key may be reused only by the same applicant for one logical submission.

alter table business_applications
  add column if not exists submission_key text,
  add column if not exists submission_fingerprint text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_application_submission_key_length') then
    alter table business_applications
      add constraint chk_application_submission_key_length
      check (submission_key is null or char_length(submission_key) between 8 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_application_submission_fingerprint') then
    alter table business_applications
      add constraint chk_application_submission_fingerprint
      check (submission_fingerprint is null or submission_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_application_submission_pair') then
    alter table business_applications
      add constraint chk_application_submission_pair
      check ((submission_key is null) = (submission_fingerprint is null));
  end if;
end $$;

create unique index if not exists uq_business_application_submission_key
  on business_applications (applicant_user_id, submission_key)
  where submission_key is not null;
