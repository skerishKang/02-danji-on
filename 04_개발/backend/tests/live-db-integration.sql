\set ON_ERROR_STOP on

-- Track D live DB integration harness.
-- Safety is enforced by tests/run-live-db-integration.sh before this file runs.
-- This DO statement is atomic: any assertion failure rolls the whole statement back.
-- On success it explicitly removes every synthetic row it created.

DO $danjion_live_gate$
DECLARE
  v_run uuid := gen_random_uuid();
  v_complex uuid := gen_random_uuid();
  v_resident uuid := gen_random_uuid();
  v_verification_resident uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_resident_membership uuid := gen_random_uuid();
  v_verification_membership uuid := gen_random_uuid();
  v_manager_membership uuid := gen_random_uuid();
  v_application uuid := gen_random_uuid();
  v_business uuid := gen_random_uuid();
  v_verification uuid := gen_random_uuid();
  v_benefit uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_slug text := 'track-d-' || substr(replace(v_run::text, '-', ''), 1, 12);
  v_claim_code text := 'DANJION-' || upper(substr(replace(v_run::text, '-', ''), 1, 8));
  v_count integer;
BEGIN
  -- Schema gate: 001-008 contract must exist on the target child branch.
  SELECT count(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'complexes', 'app_users', 'complex_memberships', 'resident_verifications',
      'businesses', 'business_complex_relations', 'benefits', 'benefit_claims',
      'business_applications', 'business_application_review_events',
      'resident_verification_review_events'
    );
  IF v_count <> 11 THEN
    RAISE EXCEPTION 'LIVE_DB_SCHEMA_MISMATCH: expected 11 core tables, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_business_application_review_history'
  ) THEN
    RAISE EXCEPTION 'LIVE_DB_SCHEMA_MISMATCH: application review trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_resident_verification_review_history'
  ) THEN
    RAISE EXCEPTION 'LIVE_DB_SCHEMA_MISMATCH: resident verification review trigger missing';
  END IF;

  INSERT INTO complexes (id, slug, name, address, status)
  VALUES (v_complex, v_slug, 'Track D Synthetic Complex', 'synthetic-only', 'pilot');

  INSERT INTO app_users (id, auth_user_id, display_name)
  VALUES
    (v_resident, 'track-d-resident-' || v_run::text, 'Track D Resident'),
    (v_verification_resident, 'track-d-verification-' || v_run::text, 'Track D Verification Resident'),
    (v_manager, 'track-d-manager-' || v_run::text, 'Track D Manager');

  INSERT INTO complex_memberships (id, complex_id, user_id, role, verification_status, verified_at)
  VALUES
    (v_resident_membership, v_complex, v_resident, 'resident', 'verified', now()),
    (v_verification_membership, v_complex, v_verification_resident, 'resident', 'pending', null),
    (v_manager_membership, v_complex, v_manager, 'manager', 'verified', now());

  -- Resident -> business application -> admin changes request -> resident resubmit -> admin approve.
  INSERT INTO business_applications (
    id, complex_id, applicant_user_id, relation_type, business_name, category_name,
    service_summary, price_text, contact_method, service_area, benefit_text,
    availability_text, status
  ) VALUES (
    v_application, v_complex, v_resident, 'resident', 'Track D Home Service', '생활서비스',
    'Synthetic Track D live DB integration application', '30,000원', 'phone_sms',
    'synthetic-only', 'Track D benefit', '평일', 'pending'
  );

  UPDATE business_applications
  SET status = 'changes_requested', review_note = 'Track D synthetic changes request',
      reviewed_by = v_manager, reviewed_at = now()
  WHERE id = v_application;

  UPDATE business_applications
  SET service_area = 'synthetic-only-updated', status = 'pending',
      reviewed_by = null, reviewed_at = null
  WHERE id = v_application AND status = 'changes_requested';

  INSERT INTO businesses (
    id, owner_user_id, kind, name, summary, description, price_text,
    service_area, availability_text, status
  ) VALUES (
    v_business, v_resident, 'service', 'Track D Home Service',
    'Synthetic Track D business', 'Synthetic Track D business', '30,000원',
    'synthetic-only-updated', '평일', 'approved'
  );

  INSERT INTO business_complex_relations (
    business_id, complex_id, relation_type, verification_status, priority, verified_by, verified_at
  ) VALUES (
    v_business, v_complex, 'resident', 'verified', 100, v_manager, now()
  );

  UPDATE business_applications
  SET status = 'approved', approved_business_id = v_business,
      review_note = 'Track D synthetic approval', reviewed_by = v_manager, reviewed_at = now()
  WHERE id = v_application AND status = 'pending';

  SELECT count(*) INTO v_count
  FROM business_application_review_events
  WHERE application_id = v_application;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'APPLICATION_FLOW_FAILED: expected >=3 review events, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM business_applications
    WHERE id = v_application AND status = 'approved' AND approved_business_id = v_business
  ) THEN
    RAISE EXCEPTION 'APPLICATION_FLOW_FAILED: approved application/business link missing';
  END IF;

  -- Resident verification: apply -> reject -> reapply -> approve, with immutable audit.
  UPDATE complex_memberships
  SET building = '102', unit = '9999', verification_status = 'pending'
  WHERE id = v_verification_membership;

  INSERT INTO resident_verifications (
    id, membership_id, method, status, requested_at
  ) VALUES (
    v_verification, v_verification_membership, 'management_confirmation', 'pending', now()
  );

  UPDATE complex_memberships
  SET verification_status = 'rejected'
  WHERE id = v_verification_membership;

  UPDATE resident_verifications
  SET status = 'rejected', note = 'Track D synthetic rejection', reviewed_by = v_manager, reviewed_at = now()
  WHERE id = v_verification;

  UPDATE complex_memberships
  SET unit = '1202', verification_status = 'pending'
  WHERE id = v_verification_membership;

  UPDATE resident_verifications
  SET status = 'pending', note = null, reviewed_by = null, reviewed_at = null, requested_at = now()
  WHERE id = v_verification;

  UPDATE complex_memberships
  SET verification_status = 'verified', verified_at = now()
  WHERE id = v_verification_membership;

  UPDATE resident_verifications
  SET status = 'verified', note = 'Track D synthetic approval', reviewed_by = v_manager, reviewed_at = now()
  WHERE id = v_verification;

  SELECT count(*) INTO v_count
  FROM resident_verification_review_events
  WHERE verification_id = v_verification;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'RESIDENT_VERIFICATION_FLOW_FAILED: expected >=3 review events, found %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM complex_memberships m
    JOIN resident_verifications rv ON rv.membership_id = m.id
    WHERE m.id = v_verification_membership
      AND m.verification_status = 'verified'
      AND rv.status = 'verified'
      AND m.building = '102'
      AND m.unit = '1202'
  ) THEN
    RAISE EXCEPTION 'RESIDENT_VERIFICATION_FLOW_FAILED: membership/verification state not synchronized';
  END IF;

  -- Benefit wallet: claim -> stored -> used.
  INSERT INTO benefits (
    id, complex_id, business_id, title, description, conditions, status
  ) VALUES (
    v_benefit, v_complex, v_business, 'Track D benefit', 'Synthetic Track D benefit',
    'synthetic-only', 'active'
  );

  INSERT INTO benefit_claims (
    id, benefit_id, user_id, complex_id, claim_code, status
  ) VALUES (
    v_claim, v_benefit, v_resident, v_complex, v_claim_code, 'stored'
  );

  UPDATE benefit_claims
  SET status = 'used', used_at = now()
  WHERE id = v_claim AND status = 'stored';

  IF NOT EXISTS (
    SELECT 1 FROM benefit_claims
    WHERE id = v_claim AND status = 'used' AND used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'BENEFIT_WALLET_FLOW_FAILED: stored -> used transition failed';
  END IF;

  -- Explicit cleanup on success. On any exception PostgreSQL rolls the whole DO statement back.
  DELETE FROM complexes WHERE id = v_complex;
  DELETE FROM businesses WHERE id = v_business;
  DELETE FROM app_users WHERE id IN (v_resident, v_verification_resident, v_manager);

  IF EXISTS (SELECT 1 FROM complexes WHERE id = v_complex)
     OR EXISTS (SELECT 1 FROM app_users WHERE id IN (v_resident, v_verification_resident, v_manager))
     OR EXISTS (SELECT 1 FROM businesses WHERE id = v_business) THEN
    RAISE EXCEPTION 'LIVE_DB_CLEANUP_FAILED: synthetic rows remain';
  END IF;

  RAISE NOTICE 'PASS Track D live DB integration: schema/application/verification/benefit/cleanup';
END
$danjion_live_gate$;
