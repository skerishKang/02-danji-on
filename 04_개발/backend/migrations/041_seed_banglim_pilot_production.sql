-- 041_seed_banglim_pilot_production.sql
-- Stage 5-C: production pilot seed for the Banglim Myeongji Roadhill complex.
--
-- Purpose
--   The production Worker/API/schema are healthy, but complexes and businesses
--   tables are empty, so public discovery always returns 404/empty. This
--   migration seeds the minimum pilot data required by the public discovery
--   API contract (core-v1.ts):
--     complexes.status = 'pilot'  (active|pilot accepted)
--     businesses.status = 'approved'
--     business_complex_relations.verification_status = 'verified'
--
-- Data policy
--   All rows are explicit PILOT PLACEHOLDER demo data.
--   NO real personal data, phone numbers, address details, or owner
--   accounts (businesses.owner_user_id is left NULL on purpose).
--   Business names/descriptions reuse the v3 Stage 4 demo catalog character,
--   not real resident/business identities.
--
-- Authority
--   Schema: 04_개발/backend/migrations/001_initial_schema.sql (+ 003 constraints)
--   API contract: 04_개발/backend/src/core-v1.ts (public discovery)
--   900/901/902 dev seeds are REFERENCE ONLY and never applied to production.
--   Root backend/ (sibling starter) migrations are NOT an authority here.
--
-- Idempotency
--   Deterministic UUIDs + ON CONFLICT DO NOTHING everywhere.
--   Existing unrelated rows are never touched. Re-running is a no-op.
--   This migration never overwrites existing rows (no ON CONFLICT DO UPDATE).
--
-- HOLD boundaries
--   benefits rows stay neutral: title/description/conditions/status only.
--   No delivery-mode/coupon/reserve-onsite semantics (#253/#139 HOLD).
--   No warmth scoring, no resident verification, no personal data (#263/#59).
--
-- Rollback plan (manual, destructive steps NOT automated in this file)
--   This migration's own pilot rows are keyed by the deterministic UUID
--   exact list below, so a manual rollback is a targeted DELETE of only
--   those ids — in FK-safe order. uuid columns are compared with exact
--   equality/IN lists only; pattern matching on uuid is never used
--   because PostgreSQL has no uuid pattern operator.
--   Pilot business ids (referred to below as PILOT_BUSINESS_IDS):
--     d0a1c4a1-41c5-4c51-b2b2-000000000001 .. 000000000008
--   Pilot benefit ids:
--     d0a1c4a1-41c5-4c51-a1b1-000000000001 .. 000000000004
--   Pilot category ids:
--     d0a1c4a1-41c5-4c51-c3c3-000000000001 .. 000000000006
--   Pilot complex id:
--     d0a1c4a1-41c5-4c51-0000-000000000001
--   Steps (write out the full IN list for PILOT_BUSINESS_IDS in each step):
--     1. DELETE FROM benefits WHERE id IN (
--          'd0a1c4a1-41c5-4c51-a1b1-000000000001'::uuid,
--          'd0a1c4a1-41c5-4c51-a1b1-000000000002'::uuid,
--          'd0a1c4a1-41c5-4c51-a1b1-000000000003'::uuid,
--          'd0a1c4a1-41c5-4c51-a1b1-000000000004'::uuid);
--     2. DELETE FROM business_complex_relations WHERE business_id IN (
--          <PILOT_BUSINESS_IDS as exact ::uuid list>);
--     3. DELETE FROM businesses WHERE id IN (<PILOT_BUSINESS_IDS exact list>);
--     4. Categories: delete ONLY rows this migration created AND that no
--          non-pilot business references:
--          DELETE FROM business_categories WHERE id IN (
--            'd0a1c4a1-41c5-4c51-c3c3-000000000001'::uuid, ... 000000000006)
--            AND NOT EXISTS (
--              SELECT 1 FROM businesses b
--              WHERE b.category_id IN (<pilot category exact list>)
--                AND b.id NOT IN (<PILOT_BUSINESS_IDS exact list>));
--          (If any non-pilot business references a pilot category, the NOT
--          EXISTS guard silently keeps that category — that is intended.)
--     5. DELETE FROM complexes
--          WHERE id = 'd0a1c4a1-41c5-4c51-0000-000000000001'::uuid
--            AND slug = 'banglim-myeongji-roadhill';  -- exact id + slug guard
--   Caution: steps must be re-checked against live FK references before
--   running. If any other rows now reference these pilot rows, STOP and use
--   a dedicated backout migration instead of ad-hoc DELETEs.
--
-- Apply contract
--   BEGIN/COMMIT keeps the whole seed atomic. Neon migration tooling runs
--   statements inside its own transaction; BEGIN/COMMIT is kept for plain
--   psql application and is harmless under tooling that strips it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Pilot complex
-- ---------------------------------------------------------------------------
insert into complexes (id, slug, name, address, status)
values (
  'd0a1c4a1-41c5-4c51-0000-000000000001',
  'banglim-myeongji-roadhill',
  '방림명지로드힐',
  '광주광역시 남구 방림동 일대 (파일럿 안내용 위치)',  -- coarse area only, no address detail
  'pilot'
)
on conflict (slug) do nothing;
  -- Same-slug existing row is assumed authoritative: validate, never overwrite.
  -- Post-apply readback must confirm status in ('active','pilot').

-- ---------------------------------------------------------------------------
-- 2) Business categories (slugs the v3 discovery UI filter chips expect)
--    Idempotent by unique slug; existing rows with the same slug are reused.
-- ---------------------------------------------------------------------------
insert into business_categories (id, slug, name, sort_order, is_active)
values
  ('d0a1c4a1-41c5-4c51-c3c3-000000000001', 'food',  '음식점·카페·반찬',  10, true),
  ('d0a1c4a1-41c5-4c51-c3c3-000000000002', 'cafe',  '카페·디저트',       20, true),
  ('d0a1c4a1-41c5-4c51-c3c3-000000000003', 'home',  '생활·홈케어',        30, true),
  ('d0a1c4a1-41c5-4c51-c3c3-000000000004', 'learn', '교육·과외',          40, true),
  ('d0a1c4a1-41c5-4c51-c3c3-000000000005', 'pro',   '전문·문서·촬영',     50, true),
  ('d0a1c4a1-41c5-4c51-c3c3-000000000006', 'car',   '자동차 정비',        60, true)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Pilot businesses (PILOT PLACEHOLDER demo data)
--    owner_user_id intentionally NULL: no owner account seeding.
--    status 'approved' satisfies the public discovery WHERE clause.
-- ---------------------------------------------------------------------------
insert into businesses (id, owner_user_id, category_id, kind, name, summary, description, price_text, service_area, availability_text, status)
select v.id::uuid, null, bc.id, v.kind, v.name, v.summary, v.description, v.price_text, v.service_area, v.availability_text, 'approved'
from (values
  ('d0a1c4a1-41c5-4c51-b2b2-000000000001','food','shop','로드힐 꽃작업실','계절 꽃다발과 작은 선물 예약 상담','파일럿 안내용 예시 가게입니다. 실제 운영 정보는 등록 후 확정됩니다.','꽃다발 · 주문 상담','광주 남구 방림동 일대','예약 상담 후 방문 수령'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000002','food','shop','오늘의 반찬','매일 만드는 국과 반찬 예약 주문','파일럿 안내용 예시 가게입니다.','반찬 · 김치 · 계절 메뉴','방림명지로드힐 인근','예약 주문 후 수령'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000003','home','service','온케어 홈서비스','에어컨·세탁기 분해 세척과 생활 점검','파일럿 안내용 예시 서비스입니다.','기종·작업 범위에 따라 상담','광주 남구 방문 서비스','평일·토요일 예약'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000004','pro','service','바른 세무상담','세무·사업자등록·기초 문서 상담','파일럿 안내용 예시 서비스입니다.','기초 상담 문의로 안내','비대면 또는 광주 남구 인근','예약 상담'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000005','learn','service','한결 수학','중·고등 수학 오답·내신 지도','파일럿 안내용 예시 서비스입니다.','학년·진도에 따라 상담','방림명지로드힐 인근','사전 상담 예약'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000006','car','service','우리동네 자동차정비','기본 점검·소모품 교체·하체 점검','파일럿 안내용 예시 서비스입니다.','차량 상태 확인 후 안내','광주 남구 생활권','월–토 예약/방문'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000007','home','service','정다운 헤어','커트와 기본 케어 생활 미용','파일럿 안내용 예시 서비스입니다.','커트 기본 요금 문의','방림동 인근','예약 우선'),
  ('d0a1c4a1-41c5-4c51-b2b2-000000000008','pro','service','사진하는 이웃','가족사진·프로필 소규모 촬영','파일럿 안내용 예시 서비스입니다.','촬영 구성에 따라 상담','광주 남구 촬영','주말·평일 저녁 예약')
) as v(id, category_slug, kind, name, summary, description, price_text, service_area, availability_text)
join business_categories bc on bc.slug = v.category_slug
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Complex relations (public discovery contract: verified)
--    verification_status is the schema value required by the public read
--    path only. It does NOT assert real resident/owner/legal verification
--    happened; these rows are explicitly pilot placeholders and carry no
--    verified_by user. relation_type mirrors the v3 relation labels.
-- ---------------------------------------------------------------------------
insert into business_complex_relations (business_id, complex_id, relation_type, verification_status, priority)
select b.id, c.id,
  case
    when b.name in ('우리동네 자동차정비') then 'neighbor'
    when b.name in ('정다운 헤어','사진하는 이웃') then 'resident_family'
    else 'resident'
  end,
  'verified', 100
from businesses b
join complexes c on c.slug = 'banglim-myeongji-roadhill'
where b.id in (
  'd0a1c4a1-41c5-4c51-b2b2-000000000001'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000002'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000003'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000004'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000005'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000006'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000007'::uuid,
  'd0a1c4a1-41c5-4c51-b2b2-000000000008'::uuid
)
on conflict (business_id, complex_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5) Benefits — neutral pilot placeholders only (#253/#139 HOLD)
--    Schema-authoritative fields only: title, description, conditions,
--    status. No dates are forced (starts_at/ends_at NULL = always active
--    window), no delivery/coupon/reserve semantics, no claim mechanics.
--    Titles stay in the neutral "예약·문의 시 확인" register that the v3 UI
--    displays via activeBenefit.title.
-- ---------------------------------------------------------------------------
insert into benefits (id, complex_id, business_id, title, description, conditions, status)
select v.id::uuid, c.id, b.id, v.title, v.description, v.conditions, 'active'
from (values
  ('d0a1c4a1-41c5-4c51-a1b1-000000000001','로드힐 꽃작업실','주민 전용 예약 혜택 안내','파일럿 예시 혜택입니다. 실제 조건은 운영 정책 확정 후 반영됩니다.','주민 확인 후 적용'),
  ('d0a1c4a1-41c5-4c51-a1b1-000000000002','오늘의 반찬','주민 할인 안내','파일럿 예시 혜택입니다. 실제 조건은 운영 정책 확정 후 반영됩니다.','주민 확인 후 적용'),
  ('d0a1c4a1-41c5-4c51-a1b1-000000000003','온케어 홈서비스','출장비 관련 안내','파일럿 예시 혜택입니다. 실제 조건은 운영 정책 확정 후 반영됩니다.','주민 확인 후 적용'),
  ('d0a1c4a1-41c5-4c51-a1b1-000000000004','바른 세무상담','첫 상담 관련 안내','파일럿 예시 혜택입니다. 실제 조건은 운영 정책 확정 후 반영됩니다.','주민 확인 후 적용')
) as v(id, business_name, title, description, conditions)
join businesses b on b.name = v.business_name
  and b.id in (
    'd0a1c4a1-41c5-4c51-b2b2-000000000001'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000002'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000003'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000004'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000005'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000006'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000007'::uuid,
    'd0a1c4a1-41c5-4c51-b2b2-000000000008'::uuid
  )
join complexes c on c.slug = 'banglim-myeongji-roadhill'
on conflict (id) do nothing;

COMMIT;
