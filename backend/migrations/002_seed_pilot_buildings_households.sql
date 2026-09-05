-- Danjion Pilot Building & Household Seed v1
-- Pilot complex: 방림명지로드힐
-- Buildings: 101동, 102동
-- Floors: 1-24
-- Units per floor: 01-04
-- Total households: 24 * 4 * 2 = 192

BEGIN;

-- 1) Seed the two authoritative buildings.
INSERT INTO buildings (complex_id, building_label, sort_order)
SELECT c.id, v.building_label, v.sort_order
FROM complexes c
CROSS JOIN (
  VALUES
    ('101동', 101),
    ('102동', 102)
) AS v(building_label, sort_order)
WHERE c.slug = 'banglim-myeongji-roadhill'
ON CONFLICT (complex_id, building_label) DO UPDATE
SET sort_order = EXCLUDED.sort_order;

-- 2) Seed 96 households per building:
--    101-104, 201-204, ... , 2401-2404.
INSERT INTO households (building_id, unit_number, status)
SELECT
  b.id,
  (floor_no * 100 + unit_no)::text AS unit_number,
  'active'
FROM buildings b
JOIN complexes c
  ON c.id = b.complex_id
CROSS JOIN generate_series(1, 24) AS floor_no
CROSS JOIN generate_series(1, 4) AS unit_no
WHERE c.slug = 'banglim-myeongji-roadhill'
  AND b.building_label IN ('101동', '102동')
ON CONFLICT (building_id, unit_number) DO NOTHING;

COMMIT;
