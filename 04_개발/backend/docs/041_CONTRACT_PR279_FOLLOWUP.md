# 041 Business Contract Expansion — PR #279 Follow-up Requirements

Issue #278. This branch (041_business_category_benefit_contract.sql) owns the schema/API
contract. PR #279's seed (currently also numbered 041) must be renumbered and extended to
consume this contract. PR #279 was NOT modified by this task.

## Required PR #279 changes

1. RENUMBER: `041_seed_banglim_pilot_production.sql` → `042_seed_banglim_pilot_production.sql`
   (both the file name and the header comment). Merge order: this contract PR first, then seed.
2. CATEGORY_RELATION_SEED: after the `businesses` inserts, add
   `insert into business_category_relations (business_id, category_id)` rows:
   - 로드힐 꽃작업실 → cafe + food (two rows; primary stays food via businesses.category_id)
   - 우리동네 자동차정비 → car + home (two rows; primary stays car)
   Keep ON CONFLICT DO NOTHING idempotency on (business_id, category_id).
   The remaining 6 businesses need no join rows (API coalesces to primary category slug).
3. VALUE_SEED: extend the `benefits` insert with `value_text`:
   F052 예약혜택 / F010 10% / H001 면제 / P001 무료 / L001 무료 / C014 공임할인 / B018 할인 / PH01 촬영할인
4. CODE_SEED: extend the `benefits` insert with `code`:
   DANJION · F052, F010, H001, P001, L001, C014, B018, PH01 (exact sibling v3 strings).
5. READBACK_UPDATE: in 04_개발/backend/docs/041_SEED_READBACK_QUERIES_*.md (rename to 042),
   flip the SCHEMA_GAP rows for MULTI_CATEGORY / BENEFIT_VALUE / BENEFIT_CODE from PARTIAL
   to COMPLETE, and add readback queries:
   - categories per business (join business_category_relations)
   - benefits value_text/code round-trip
6. ROLLBACK_UPDATE: rollback steps gain:
   - DELETE FROM business_category_relations WHERE business_id IN (<PILOT_BUSINESS_IDS>)
     (before deleting businesses, FK-safe order)
   - benefit deletes already cover value_text/code (same rows).

## Dependency direction

- This contract PR must merge BEFORE the renumbered seed PR.
- The seed PR does not need this branch's API change to merge (schema-only columns),
  but production apply order is: 041 contract → 042 seed.
- The Stage 5-A frontend bridge (PR #281, merged) currently consumes
  `activeBenefit.title/conditions` and single `categorySlug`; a follow-up frontend
  bridge task can switch to `categories[]` / `activeBenefit.value/code` once seeded
  data exists. No frontend change is required by this contract PR.
