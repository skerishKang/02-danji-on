-- Danjion Core Identity & Residency Schema v1
-- Scope: complex / building / household / user / membership / resident verification / roles
-- Pilot: Banglim Myeongji Roadhill (seeded only at complex level)
-- IMPORTANT: exact building/unit and verification evidence are private data.

BEGIN;

CREATE TABLE IF NOT EXISTS complexes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pilot'
    CHECK (status IN ('pilot', 'active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buildings (
  id BIGSERIAL PRIMARY KEY,
  complex_id BIGINT NOT NULL REFERENCES complexes(id) ON DELETE CASCADE,
  building_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (complex_id, building_label)
);

CREATE TABLE IF NOT EXISTS households (
  id BIGSERIAL PRIMARY KEY,
  building_id BIGINT NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  unit_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (building_id, unit_number)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  auth_provider TEXT,
  auth_subject TEXT,
  display_name TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_identity_unique
  ON users (auth_provider, auth_subject)
  WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('resident', 'business_owner', 'operator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS household_members (
  id BIGSERIAL PRIMARY KEY,
  household_id BIGINT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'resident'
    CHECK (relationship_type IN ('resident', 'owner', 'tenant', 'family', 'other')),
  membership_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (membership_status IN ('pending', 'verified', 'ended')),
  joined_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS resident_verifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id BIGINT NOT NULL REFERENCES households(id) ON DELETE RESTRICT,
  verification_method TEXT NOT NULL DEFAULT 'manual_operator'
    CHECK (verification_method IN (
      'manual_operator',
      'document',
      'household_invite',
      'management_confirmation',
      'other'
    )),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'approved',
      'needs_revision',
      'rejected',
      'expired',
      'revoked'
    )),

  -- PRIVATE: storage key/reference only. Never expose this field through public APIs.
  evidence_storage_key TEXT,

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

  -- PRIVATE: operator-only note. Never expose this field through resident APIs.
  reviewer_note_private TEXT,

  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS household_members_user_idx
  ON household_members (user_id);

CREATE INDEX IF NOT EXISTS resident_verifications_user_status_idx
  ON resident_verifications (user_id, status);

CREATE INDEX IF NOT EXISTS resident_verifications_household_status_idx
  ON resident_verifications (household_id, status);

-- Canonical pilot complex only.
-- Building/unit seeds are intentionally NOT included until the authoritative list is confirmed.
INSERT INTO complexes (name, slug, status)
VALUES ('방림명지로드힐', 'banglim-myeongji-roadhill', 'pilot')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
