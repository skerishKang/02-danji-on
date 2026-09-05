BEGIN;

ALTER TABLE business_applications
ADD COLUMN IF NOT EXISTS reviewer_note_to_applicant TEXT;

COMMIT;