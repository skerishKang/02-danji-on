-- 단지온 이웃가게 / 주민서비스 핵심 스키마
-- 003_neighbor_business_core.sql

BEGIN;

-- =========================================================
-- 1. 카테고리
-- =========================================================

CREATE TABLE IF NOT EXISTS business_categories (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 2. 가게 / 서비스
-- 점포 없는 과외, 방문서비스, 전문서비스, 온라인 판매 포함
-- =========================================================

CREATE TABLE IF NOT EXISTS businesses (
  id BIGSERIAL PRIMARY KEY,

  name TEXT NOT NULL,

  business_kind TEXT NOT NULL
    CHECK (
      business_kind IN (
        'storefront',
        'professional_service',
        'visit_service',
        'lesson',
        'online_seller',
        'other'
      )
    ),

  category_id BIGINT
    REFERENCES business_categories(id)
    ON DELETE SET NULL,

  short_intro TEXT,
  description TEXT,

  -- 실제 점포가 있는 경우에만 사용
  address_text TEXT,

  -- 방문서비스/과외/온라인 등
  service_area_text TEXT,

  phone TEXT,
  contact_url TEXT,

  approval_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      approval_status IN (
        'draft',
        'pending',
        'approved',
        'needs_revision',
        'rejected',
        'suspended',
        'archived'
      )
    ),

  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  reviewer_note_private TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_category
  ON businesses(category_id);

CREATE INDEX IF NOT EXISTS idx_businesses_approval_status
  ON businesses(approval_status);

CREATE INDEX IF NOT EXISTS idx_businesses_kind
  ON businesses(business_kind);

-- =========================================================
-- 3. 가게 운영자
-- 한 가게를 여러 명이 공동 운영할 수도 있음
-- =========================================================

CREATE TABLE IF NOT EXISTS business_owners (
  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  user_id BIGINT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  owner_role TEXT NOT NULL DEFAULT 'owner'
    CHECK (
      owner_role IN (
        'owner',
        'co_owner',
        'manager'
      )
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_owners_user
  ON business_owners(user_id);

-- =========================================================
-- 4. 단지와 가게의 관계
--
-- 노출 우선순위:
-- 1 current_resident
-- 2 resident_family
-- 3 neighbor_complex_resident
-- 4 local_partner
-- =========================================================

CREATE TABLE IF NOT EXISTS business_complex_relationships (
  id BIGSERIAL PRIMARY KEY,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  complex_id BIGINT NOT NULL
    REFERENCES complexes(id)
    ON DELETE CASCADE,

  relationship_type TEXT NOT NULL
    CHECK (
      relationship_type IN (
        'current_resident',
        'resident_family',
        'neighbor_complex_resident',
        'local_partner'
      )
    ),

  -- 가족운영 등에서 관계를 확인해 준 주민
  verified_resident_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      verification_status IN (
        'pending',
        'verified',
        'needs_revision',
        'rejected',
        'revoked'
      )
    ),

  verified_at TIMESTAMPTZ,

  verified_by_user_id BIGINT
    REFERENCES users(id)
    ON DELETE SET NULL,

  verifier_note_private TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (business_id, complex_id)
);

CREATE INDEX IF NOT EXISTS idx_business_relationship_complex
  ON business_complex_relationships(complex_id);

CREATE INDEX IF NOT EXISTS idx_business_relationship_status
  ON business_complex_relationships(
    complex_id,
    verification_status,
    relationship_type
  );

-- =========================================================
-- 5. 주민 전용 혜택
-- 결제/정산 기능은 하지 않고 혜택 정보만 제공
-- =========================================================

CREATE TABLE IF NOT EXISTS business_benefits (
  id BIGSERIAL PRIMARY KEY,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,

  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'draft',
        'active',
        'paused',
        'expired',
        'archived'
      )
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    valid_until IS NULL
    OR valid_from IS NULL
    OR valid_until >= valid_from
  )
);

CREATE INDEX IF NOT EXISTS idx_business_benefits_business
  ON business_benefits(business_id);

CREATE INDEX IF NOT EXISTS idx_business_benefits_status
  ON business_benefits(status);

-- =========================================================
-- 6. 영업시간
-- 요일별 1행
-- =========================================================

CREATE TABLE IF NOT EXISTS business_hours (
  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  day_of_week SMALLINT NOT NULL
    CHECK (day_of_week BETWEEN 0 AND 6),

  open_time TIME,
  close_time TIME,

  is_closed BOOLEAN NOT NULL DEFAULT FALSE,

  PRIMARY KEY (business_id, day_of_week),

  CHECK (
    is_closed = TRUE
    OR (
      open_time IS NOT NULL
      AND close_time IS NOT NULL
    )
  )
);

-- =========================================================
-- 7. 기본 카테고리
-- 고령 주민도 이해하기 쉬운 단순 카테고리
-- =========================================================

INSERT INTO business_categories (
  slug,
  name,
  sort_order
)
VALUES
  ('food-cafe', '음식·카페', 10),
  ('living-repair', '생활·수리', 20),
  ('health-beauty', '건강·뷰티', 30),
  ('education-lesson', '교육·과외', 40),
  ('professional', '전문서비스', 50),
  ('visit-service', '방문서비스', 60),
  ('online-sales', '온라인·판매', 70),
  ('other', '기타', 100)
ON CONFLICT (slug)
DO NOTHING;

COMMIT;