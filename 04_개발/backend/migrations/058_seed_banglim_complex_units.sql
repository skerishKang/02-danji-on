-- DanjiOn Issue #860: Seed complex_units for banglim-myeongji-roadhill
-- Root cause: 042_seed_banglim_pilot_production.sql seeds the complex but not
-- the individual unit master rows, so GET /household/units returns [].
--
-- This migration backfills 192 unit master rows:
--   2 buildings (101, 102) x 24 floors x 4 units per floor = 192
--   Unit code pattern: floor_no * 100 + unit_no (101-104, 201-204, ... 2401-2404)
--
-- Convention
--   building_code and unit_code are stored WITHOUT Korean suffixes
--   (e.g. '101', '1802'). Frontend adds '동'/'호' via part() for display.
--   This matches admin-unit-master contract (admin-unit-master-contract.mjs)
--   and legacy household unit_number convention.
--
-- Floor count assumption
--   The 24-floor layout is inherited from legacy migration
--   002_seed_pilot_buildings_households.sql, which defines 2 buildings
--   (101동, 102동) x floors 1-24 x 4 units per floor = 192 households.
--   This seed follows that exact layout. If the actual residential floor
--   count differs (e.g. 1F commercial, 2F-25F residential), a follow-up
--   migration should adjust the unit codes to match the real layout.
--
-- Contract
--   Scope: complex_units INSERT only.
--   No household, household_membership, app_user, or account mutation.
--   Deterministic UUIDs ensure idempotent reruns.
--   ON CONFLICT (complex_id, building_code, unit_code) DO NOTHING
--     prevents duplicate inserts on rerun.
--   Existing production rows are never modified or deleted.
--   Does NOT apply 900/901/902 dev fixtures.
--
-- Authority
--   Complex source: resolved at runtime via complexes.slug lookup
--   Unit pattern: 002_seed_pilot_buildings_households.sql (legacy schema)
--   Schema: 009_household_foundation.sql + 055_complex_unit_master_provenance.sql
--
-- Rollback (manual, destructive)
--   DELETE FROM complex_units
--   WHERE complex_id = (
--     SELECT id FROM complexes WHERE slug = 'banglim-myeongji-roadhill'
--   )
--     AND id IN (
--       'd0a1c4a1-41c5-4c51-a101-000000000001'..'d0a1c4a1-41c5-4c51-a101-000000000096',
--       'd0a1c4a1-41c5-4c51-a102-000000000001'..'d0a1c4a1-41c5-4c51-a102-000000000096'
--     );

BEGIN;

INSERT INTO complex_units (id, complex_id, building_code, unit_code, status)
SELECT
  ('d0a1c4a1-41c5-4c51-'
   || CASE WHEN b.building_code = '101' THEN 'a101-' ELSE 'a102-' END
   || lpad(to_char(ROW_NUMBER() OVER (PARTITION BY b.building_code ORDER BY u.unit_code_int), 'FM999'), 12, '0')
  )::uuid,
  c.id,
  b.building_code,
  u.unit_code_int::text,
  'active'
FROM complexes c
CROSS JOIN (VALUES ('101'), ('102')) AS b(building_code)
CROSS JOIN (
  SELECT floor_no * 100 + unit_no AS unit_code_int
  FROM generate_series(1, 24) AS floor_no
  CROSS JOIN generate_series(1, 4) AS unit_no
) AS u
WHERE c.slug = 'banglim-myeongji-roadhill'
ON CONFLICT (complex_id, building_code, unit_code) DO NOTHING;

COMMIT;
