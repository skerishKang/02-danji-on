import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Regression contract: approval/materialization must never create an approved
// business with businesses.category_id = NULL. Category resolution is exact
// canonical matching with is_active = true, fail-closed, identical across the
// application lanes and the Report R-B recommendation lane. No fuzzy/contains
// matching, no category auto-creation, no relation-table writes, no schema
// changes to the category tables.
//
// The application lanes (admin-v1, admin-operational-v2) resolve by exact
// canonical business_categories.name. The recommendation lane (Report R-B,
// shop-recommendations-v1) resolves at intake and approves ONLY on
// resolved_category_id; legacy category_name is not an approval authority.

const root = new URL('../', import.meta.url);
const [adminV1, adminV2, shopRec, schema, relationsMigration] = await Promise.all([
  readFile(new URL('src/admin-v1.ts', root), 'utf8'),
  readFile(new URL('src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('src/shop-recommendations-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/001_initial_schema.sql', root), 'utf8'),
  readFile(new URL('migrations/041_business_category_benefit_contract.sql', root), 'utf8')
]);

const nameSources = [
  ['admin-v1', adminV1],
  ['admin-operational-v2', adminV2]
];

const atomicSources = [
  ...nameSources,
  ['shop-recommendations-v1', shopRec]
];

// 1. Both application paths share the identical fail-closed name resolver.
for (const [name, src] of nameSources) {
  assert.ok(src.includes("from business_categories bc\n    where bc.name = ${categoryName}\n    limit 1"),
    `${name} must resolve category by exact canonical name`);
  assert.ok(src.includes("if (!row) {\n    return { code: 'CATEGORY_NOT_RESOLVED'"),
    `${name} must fail closed on unknown category name`);
  assert.ok(src.includes("if (!row.is_active) {\n    return { code: 'CATEGORY_NOT_ACTIVE'"),
    `${name} must fail closed on inactive category`);
  assert.doesNotMatch(src, /ilike|similar to|% \|\||strpos|levenshtein|fuzzy/i,
    `${name} must not use fuzzy or contains matching`);
  assert.doesNotMatch(src, /insert into business_categories/i,
    `${name} must never auto-create categories`);
  assert.doesNotMatch(src, /insert into business_category_relations/i,
    `${name} must not populate relation table (separate unresolved contract)`);
}

// 2. Exact-active resolution inside the atomic approval CTE (race gate).
for (const [name, src] of nameSources) {
  assert.ok(src.includes("and exists (\n          select 1 from business_categories bc\n          where bc.name = a.category_name\n            and bc.is_active = true\n        )") ||
    src.includes("and exists (\n            select 1 from business_categories bc\n            where bc.name = r.category_name\n              and bc.is_active = true\n          )"),
    `${name} approval CTE must gate on active exact category`);
  assert.match(src, /where bc\.name = a\.category_name and bc\.is_active = true limit 1/i,
    `${name} business insert must resolve category_id with active exact match`);
  assert.doesNotMatch(src, /where bc\.name = a\.category_name limit 1/i,
    `${name} must not keep a non-active-checked inline category resolution`);
}

// 3. Approval pre-check happens before the CTE and uses 409 fail-closed.
for (const [name, src] of nameSources) {
  const idxResolve = src.indexOf('async function resolveApprovalCategory');
  const idxCte = src.indexOf('with approved as (');
  assert.ok(idxResolve > -1 && idxCte > idxResolve, `${name} must resolve category before the approval CTE`);
  assert.ok(src.includes("return fail(categoryError.code, categoryError.message, 409, requestId);"),
    `${name} must fail closed with 409 when category cannot resolve`);
}

// 4. CTE atomicity preserved: single data-modifying statement, UPDATE is the gate.
for (const [name, src] of atomicSources) {
  assert.ok(src.includes('with approved as ('), `${name} must keep the atomic CTE approval gate`);
  assert.ok(src.includes("status in ('pending','changes_requested')"), `${name} must keep the reviewable-state gate`);
  assert.doesNotMatch(src, /\bbegin\b|\bcommit\b/i, `${name} must keep single-statement atomicity (no manual transaction churn)`);
}

// 5. Recommendation lane (Report R-B): fail-closed on the resolved authority,
// domain-consistent changes_requested transition.
assert.ok(shopRec.includes("set status = 'changes_requested',"),
  'shop-recommendations must transition unresolved approvals to changes_requested');
assert.ok(shopRec.includes('categoryUnresolved: authorityError.code'),
  'shop-recommendations response must surface categoryUnresolved marker');
assert.ok(shopRec.includes("r.resolved_category_id,\n           r.resolved_relation_type, c.slug as complex_slug"),
  'shop-recommendations must read the resolved authority for fail-closed resolution');
assert.doesNotMatch(shopRec, /where bc\.name = [ar]\.category_name/,
  'shop-recommendations must not approve on legacy category_name');
assert.match(shopRec, /status = 'pending'[\s\S]*review_note = null[\s\S]*reviewed_by = null[\s\S]*reviewed_at = null/i,
  'resubmission loop must remain intact for reporter recovery');

// 6. Application lanes: fail-closed leaves the record unapproved (no silent transition).
assert.ok(adminV1.includes('const categoryError = await resolveApprovalCategory(sql, String(current.category_name'));
assert.ok(adminV2.includes('const categoryError = await resolveApprovalCategory(sql, String(current.category_name'));
assert.doesNotMatch(adminV1, /categoryUnresolved/, 'admin-v1 must not adopt the recommendation transition shape');
assert.doesNotMatch(adminV2, /categoryUnresolved/, 'admin-operational-v2 must not adopt the recommendation transition shape');

// 7. Both application lanes expose category_name in their context lookups.
assert.ok(adminV1.includes('a.approved_business_id, a.category_name, c.slug as complex_slug'),
  'admin-v1 application context must select category_name');
assert.ok(adminV2.includes('a.representative_image_object_key, a.category_name, c.slug as complex_slug'),
  'admin-operational-v2 application context must select category_name');

// 8. Schema/migration boundaries: category_id remains nullable (no schema change here),
//    relations table untouched, existing categories table shape unchanged.
assert.match(schema, /category_id uuid references business_categories\(id\) on delete set null/i);
assert.match(relationsMigration, /create table if not exists business_category_relations/i);

console.log('PASS category approval is fail-closed and consistent across all materialization paths');
