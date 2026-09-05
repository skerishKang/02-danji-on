BEGIN;

-- =========================================================
-- PHASE 3
-- 내 가게 등록 신청 / 이웃가게 제보
-- =========================================================

CREATE TABLE IF NOT EXISTS business_applications (
  id BIGSERIAL PRIMARY KEY,

  applicant_user_id BIGINT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  complex_id BIGINT NOT NULL
    REFERENCES complexes(id)
    ON DELETE CASCADE,

  application_mode TEXT NOT NULL
    CHECK (
      application_mode IN (
        'owner',
        'report'
      )
    ),

  -- -------------------------------------------------------
  -- 공통
  -- -------------------------------------------------------

  shop_name TEXT NOT NULL,

  relation_code TEXT NOT NULL,

  relation_detail TEXT,

  -- -------------------------------------------------------
  -- 내 가게 등록 신청(owner)
  -- 최신 25A 화면 기준
  -- -------------------------------------------------------

  category_text TEXT,

  hours_text TEXT,

  service_price_text TEXT,

  location_use_text TEXT,

  benefit_text TEXT,

  contact_text TEXT,

  extra_intro TEXT,

  -- -------------------------------------------------------
  -- 이웃가게 제보(report)
  -- -------------------------------------------------------

  report_what TEXT,

  report_price TEXT,

  report_hours TEXT,

  report_location TEXT,

  report_reason TEXT,

  -- -------------------------------------------------------
  -- 상태
  -- -------------------------------------------------------

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'submitted',
        'needs_more_info',
        'approved',
        'rejected',
        'published'
      )
    ),

  submitted_at TIMESTAMPTZ,

  reviewed_at TIMESTAMPTZ,

  reviewed_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  reviewer_note_private TEXT,

  -- 승인 후 실제 businesses 레코드와 연결
  published_business_id BIGINT
    REFERENCES businesses(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- -------------------------------------------------------
  -- 모드별 최소 필수값
  -- -------------------------------------------------------

  CONSTRAINT business_application_owner_required
  CHECK (
    application_mode <> 'owner'
    OR (
      NULLIF(TRIM(category_text), '') IS NOT NULL
      AND NULLIF(TRIM(hours_text), '') IS NOT NULL
      AND NULLIF(TRIM(service_price_text), '') IS NOT NULL
      AND NULLIF(TRIM(location_use_text), '') IS NOT NULL
      AND NULLIF(TRIM(contact_text), '') IS NOT NULL
    )
  ),

  CONSTRAINT business_application_report_required
  CHECK (
    application_mode <> 'report'
    OR (
      NULLIF(TRIM(report_what), '') IS NOT NULL
      AND NULLIF(TRIM(report_location), '') IS NOT NULL
      AND NULLIF(TRIM(report_reason), '') IS NOT NULL
    )
  )
);


CREATE INDEX IF NOT EXISTS
idx_business_applications_applicant
ON business_applications(
  applicant_user_id,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_business_applications_complex_status
ON business_applications(
  complex_id,
  status,
  created_at DESC
);


CREATE INDEX IF NOT EXISTS
idx_business_applications_mode_status
ON business_applications(
  application_mode,
  status,
  created_at DESC
);


-- =========================================================
-- 신청 첨부파일 메타데이터
--
-- 아직 실제 파일을 이 테이블에 넣는 단계는 아님.
-- 다음 storage 단계에서 storage_key와 연결한다.
--
-- proof / other_document 등은 PRIVATE
-- photo는 PUBLIC 후보
-- =========================================================

CREATE TABLE IF NOT EXISTS business_application_files (
  id BIGSERIAL PRIMARY KEY,

  application_id BIGINT NOT NULL
    REFERENCES business_applications(id)
    ON DELETE CASCADE,

  file_kind TEXT NOT NULL
    CHECK (
      file_kind IN (
        'proof',
        'other_document',
        'photo',
        'reference_document'
      )
    ),

  visibility TEXT NOT NULL
    CHECK (
      visibility IN (
        'public',
        'private'
      )
    ),

  storage_key TEXT NOT NULL UNIQUE,

  original_name TEXT NOT NULL,

  mime_type TEXT,

  byte_size BIGINT,

  sort_order INTEGER NOT NULL DEFAULT 100,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS
idx_business_application_files_application
ON business_application_files(
  application_id,
  file_kind,
  sort_order
);


-- =========================================================
-- 상태 변경 이력
--
-- 신청자가 제출
-- 운영자가 수정요청
-- 승인
-- 거절
-- 실제 가게 발행
-- 을 나중에 추적할 수 있게 한다.
-- =========================================================

CREATE TABLE IF NOT EXISTS business_application_events (
  id BIGSERIAL PRIMARY KEY,

  application_id BIGINT NOT NULL
    REFERENCES business_applications(id)
    ON DELETE CASCADE,

  actor_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  from_status TEXT,

  to_status TEXT NOT NULL,

  note_private TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS
idx_business_application_events_application
ON business_application_events(
  application_id,
  created_at
);


COMMIT;