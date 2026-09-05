BEGIN;

-- =========================================================
-- 1. 최신 프론트 필터와 백엔드 카테고리 연결
--    기존 세부 카테고리는 유지하고 filter_key만 연결한다.
-- =========================================================

ALTER TABLE business_categories
ADD COLUMN IF NOT EXISTS filter_key TEXT;

UPDATE business_categories
SET filter_key =
  CASE slug
    WHEN 'food-cafe' THEN 'cafe'
    WHEN 'living-repair' THEN 'home'
    WHEN 'health-beauty' THEN 'home'
    WHEN 'education-lesson' THEN 'learn'
    WHEN 'professional' THEN 'pro'
    WHEN 'visit-service' THEN 'home'
    ELSE filter_key
  END;

-- 현재 프론트의 "식품·반찬"
INSERT INTO business_categories (
  slug,
  name,
  sort_order,
  is_active,
  filter_key
)
VALUES (
  'food-grocery',
  '식품·반찬',
  15,
  TRUE,
  'food'
)
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  filter_key = EXCLUDED.filter_key;

-- 현재 프론트의 "자동차"
INSERT INTO business_categories (
  slug,
  name,
  sort_order,
  is_active,
  filter_key
)
VALUES (
  'automotive',
  '자동차',
  35,
  TRUE,
  'car'
)
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  filter_key = EXCLUDED.filter_key;


-- =========================================================
-- 2. 가게별 영구 공유 slug
--    가게 ID가 생성되면 shop-1, shop-2 ... 형태로 자동 고정
-- =========================================================

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS public_slug TEXT
GENERATED ALWAYS AS (
  'shop-' || id::text
) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS
idx_businesses_public_slug
ON businesses(public_slug);


-- =========================================================
-- 3. 홈 대표 이웃가게
-- =========================================================

CREATE TABLE IF NOT EXISTS featured_businesses (
  id BIGSERIAL PRIMARY KEY,

  complex_id BIGINT NOT NULL
    REFERENCES complexes(id)
    ON DELETE CASCADE,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  sort_order INTEGER NOT NULL DEFAULT 100,

  scene_label TEXT,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (complex_id, business_id)
);

CREATE INDEX IF NOT EXISTS
idx_featured_businesses_complex
ON featured_businesses(
  complex_id,
  is_active,
  sort_order
);

-- 현재 승인된 가게를 홈 featured 후보로 자동 등록
INSERT INTO featured_businesses (
  complex_id,
  business_id,
  sort_order,
  scene_label
)
SELECT
  rel.complex_id,
  biz.id,

  ROW_NUMBER() OVER (
    PARTITION BY rel.complex_id
    ORDER BY biz.updated_at DESC, biz.id
  )::INTEGER,

  '우리 단지 이웃의 일'

FROM businesses biz

JOIN business_complex_relationships rel
  ON rel.business_id = biz.id
 AND rel.verification_status = 'verified'

WHERE biz.approval_status = 'approved'

ON CONFLICT (complex_id, business_id)
DO NOTHING;


-- =========================================================
-- 4. 가게 저장 / 찜
-- =========================================================

CREATE TABLE IF NOT EXISTS saved_businesses (
  user_id BIGINT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (
    user_id,
    business_id
  )
);

CREATE INDEX IF NOT EXISTS
idx_saved_businesses_user_created
ON saved_businesses(
  user_id,
  created_at DESC
);


-- =========================================================
-- 5. 주민 후기
--    별점 없음. 글 후기만 사용.
-- =========================================================

CREATE TABLE IF NOT EXISTS business_reviews (
  id BIGSERIAL PRIMARY KEY,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  author_user_id BIGINT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  body TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'hidden',
        'deleted'
      )
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_business_reviews_business
ON business_reviews(
  business_id,
  status,
  created_at DESC
);

CREATE INDEX IF NOT EXISTS
idx_business_reviews_author
ON business_reviews(
  author_user_id,
  created_at DESC
);


-- =========================================================
-- 6. 점주 후기 답변
--    후기 1개당 공개 답변 1개
-- =========================================================

CREATE TABLE IF NOT EXISTS business_review_replies (
  id BIGSERIAL PRIMARY KEY,

  review_id BIGINT NOT NULL UNIQUE
    REFERENCES business_reviews(id)
    ON DELETE CASCADE,

  author_user_id BIGINT NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  body TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'hidden',
        'deleted'
      )
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 7. 가게 서비스 / 품목
-- =========================================================

CREATE TABLE IF NOT EXISTS business_services (
  id BIGSERIAL PRIMARY KEY,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  title TEXT NOT NULL,

  price_text TEXT,

  description TEXT,

  sort_order INTEGER NOT NULL DEFAULT 100,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_business_services_business
ON business_services(
  business_id,
  is_active,
  sort_order
);


-- =========================================================
-- 8. 가게 소식
-- =========================================================

CREATE TABLE IF NOT EXISTS business_news (
  id BIGSERIAL PRIMARY KEY,

  business_id BIGINT NOT NULL
    REFERENCES businesses(id)
    ON DELETE CASCADE,

  title TEXT NOT NULL,

  body TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'published'
    CHECK (
      status IN (
        'draft',
        'published',
        'archived'
      )
    ),

  published_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_business_news_business
ON business_news(
  business_id,
  status,
  published_at DESC
);

COMMIT;