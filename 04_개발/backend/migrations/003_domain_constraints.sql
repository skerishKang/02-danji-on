-- DanjiOn domain constraints and duplicate guards.
-- Safe to apply after 001_initial_schema.sql and 002_admin_workflow.sql.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_name_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_name_length CHECK (char_length(name) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_summary_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_summary_length CHECK (char_length(summary) <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_description_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_description_length CHECK (char_length(description) <= 5000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_price_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_price_length CHECK (price_text IS NULL OR char_length(price_text) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_service_area_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_service_area_length CHECK (service_area IS NULL OR char_length(service_area) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_availability_length') THEN
    ALTER TABLE businesses ADD CONSTRAINT chk_business_availability_length CHECK (availability_text IS NULL OR char_length(availability_text) <= 200);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_business_name_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_business_name_length CHECK (char_length(business_name) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_category_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_category_length CHECK (char_length(category_name) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_summary_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_summary_length CHECK (char_length(service_summary) BETWEEN 1 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_price_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_price_length CHECK (price_text IS NULL OR char_length(price_text) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_contact_method_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_contact_method_length CHECK (contact_method IS NULL OR char_length(contact_method) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_service_area_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_service_area_length CHECK (service_area IS NULL OR char_length(service_area) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_benefit_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_benefit_length CHECK (benefit_text IS NULL OR char_length(benefit_text) <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_availability_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_availability_length CHECK (availability_text IS NULL OR char_length(availability_text) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_application_review_note_length') THEN
    ALTER TABLE business_applications ADD CONSTRAINT chk_application_review_note_length CHECK (review_note IS NULL OR char_length(review_note) <= 1000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_post_source_length') THEN
    ALTER TABLE complex_posts ADD CONSTRAINT chk_post_source_length CHECK (char_length(source_name) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_post_category_length') THEN
    ALTER TABLE complex_posts ADD CONSTRAINT chk_post_category_length CHECK (char_length(category) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_post_title_length') THEN
    ALTER TABLE complex_posts ADD CONSTRAINT chk_post_title_length CHECK (char_length(title) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_post_body_length') THEN
    ALTER TABLE complex_posts ADD CONSTRAINT chk_post_body_length CHECK (char_length(body) BETWEEN 1 AND 10000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_benefit_title_length') THEN
    ALTER TABLE benefits ADD CONSTRAINT chk_benefit_title_length CHECK (char_length(title) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_benefit_description_length') THEN
    ALTER TABLE benefits ADD CONSTRAINT chk_benefit_description_length CHECK (char_length(description) <= 2000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_benefit_conditions_length') THEN
    ALTER TABLE benefits ADD CONSTRAINT chk_benefit_conditions_length CHECK (conditions IS NULL OR char_length(conditions) <= 1000);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_business_contact_value_length') THEN
    ALTER TABLE business_contacts ADD CONSTRAINT chk_business_contact_value_length CHECK (char_length(contact_value) BETWEEN 1 AND 500);
  END IF;
END $$;

-- Prevent accidental duplicate active applications from repeated clicks/retries.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_application_name_per_user_complex
ON business_applications (complex_id, applicant_user_id, lower(business_name))
WHERE status IN ('draft','pending','changes_requested');

-- Prevent exact duplicate contact rows for one business.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_contact_exact
ON business_contacts (business_id, contact_type, contact_value);
