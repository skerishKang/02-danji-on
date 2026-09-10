import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Report R-B contract (CENTRAL): shop recommendation reports preserve the
// raw relation, keep legacy category_name / relation_type nullable and
// non-authoritative, and approve ONLY on resolved_category_id +
// resolved_relation_type with fail-closed semantics.

const root = new URL('../', import.meta.url);
const [migration, api] = await Promise.all([
  readFile(new URL('migrations/046_report_rb_schema.sql', root), 'utf8'),
  readFile(new URL('src/shop-recommendations-v1.ts', root), 'utf8')
]);

// 1. Legacy intake fields are relaxed to nullable.
assert.match(migration, /alter column category_name drop not null/i,
  'migration must relax legacy category_name to nullable');
assert.match(migration, /alter column relation_type drop not null/i,
  'migration must relax legacy relation_type to nullable');
assert.match(migration, /relation_type is null or relation_type in \('resident_family','neighbor','local'\)/i,
  'legacy relation check must stay bounded while allowing NULL');
assert.match(migration, /category_name is null or char_length\(category_name\) between 1 and 120/i,
  'legacy category length check must allow NULL');

// 2. The six R-B reporting columns exist with the accepted shapes.
for (const column of [
  'reported_relation_raw', 'resolved_relation_type', 'relation_detail',
  'resolved_category_id', 'report_price', 'report_hours'
]) {
  assert.ok(migration.includes(`add column if not exists ${column}`),
    `migration must add R-B column ${column}`);
}
assert.match(migration, /resolved_category_id uuid references business_categories\(id\) on delete set null/i,
  'resolved_category_id must FK the canonical category with set-null delete semantics');
assert.match(migration, /resolved_relation_type is null or resolved_relation_type in \('resident_family','neighbor','local'\)/i,
  'resolved relation must be bounded to the materializable relation domain');

// 3. History keeps its raw relation.
assert.match(migration, /reported_relation_raw = relation_type/i,
  'migration must backfill the raw relation from legacy rows');

// 4. Intake preserves raw and pre-resolves ONLY family / neighbor.
assert.ok(api.includes('reportedRelationRaw'), 'intake must carry the raw relation');
assert.ok(api.includes("family: 'resident_family'"), 'family must pre-resolve to resident_family');
assert.ok(api.includes("neighbor: 'neighbor'"), 'neighbor must pre-resolve to neighbor');
assert.doesNotMatch(api, /nearby['"]?\s*:\s*['"]local/,
  'nearby -> local auto-resolve is FORBIDDEN');
assert.match(api, /insert into shop_recommendations \([\s\S]*reported_relation_raw[\s\S]*resolved_relation_type[\s\S]*relation_detail[\s\S]*resolved_category_id[\s\S]*report_price[\s\S]*report_hours/s,
  'create insert must persist the full R-B report row');

// 5. Category is optional at intake; resolution is exact active-name only.
assert.doesNotMatch(api, /categoryName\.length < 1/,
  'report intake must not require a category');
assert.ok(api.includes('async function resolveReportCategory'),
  'intake must resolve an optional category to the canonical id');
assert.match(api, /where bc\.name = \$\{categoryName\}\s+and bc\.is_active = true/s,
  'intake category resolution must be exact active-name only');

// 6. Approval authority is ONLY resolved_category_id + resolved_relation_type.
assert.ok(api.includes('async function resolveApprovalAuthority'),
  'approval must use the resolved-only authority resolver');
assert.doesNotMatch(api, /where bc\.name = a\.category_name/,
  'approval must not resolve authority from legacy category_name (business insert)');
assert.doesNotMatch(api, /where bc\.name = r\.category_name/,
  'approval must not resolve authority from legacy category_name (approval gate)');
assert.ok(api.includes('and r.resolved_category_id is not null'),
  'approval CTE must gate on resolved_category_id');
assert.ok(api.includes('and r.resolved_relation_type is not null'),
  'approval CTE must gate on resolved_relation_type');
assert.ok(api.includes('where bc.id = r.resolved_category_id'),
  'approval CTE must gate on the active canonical category by id');
assert.ok(api.includes('a.resolved_category_id,'),
  'approved business must materialize resolved_category_id directly');
assert.ok(api.includes('a.complex_id, a.resolved_relation_type,'),
  'approved relation must materialize resolved_relation_type');

// 7. Unresolved reports fail closed through the reporter-recovery loop.
assert.ok(api.includes("code: 'REPORT_RB_UNRESOLVED'"),
  'missing resolved authority must fail closed');
assert.ok(api.includes('categoryUnresolved: authorityError.code'),
  'unresolved approvals must surface the recovery marker');
assert.ok(api.includes("set status = 'changes_requested',"),
  'unresolved approvals must return the report to changes_requested');

// 8. Presentation-safe row exposes the R-B report fields.
for (const field of [
  'reportedRelationRaw:', 'resolvedRelationType:', 'relationDetail:',
  'resolvedCategoryId:', 'reportPrice:', 'reportHours:'
]) {
  assert.ok(api.includes(field), `recommendation response must expose ${field}`);
}

console.log('PASS report R-B schema and backend authority are fail-closed');
