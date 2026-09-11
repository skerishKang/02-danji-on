import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #341 [owner relation contract]: business_applications preserves the
// canonical raw relation (self|co|family|etc), resolves ONLY self -> resident
// and family -> resident_family at intake, and blocks approval fail-closed
// while unresolved (no co -> neighbor, no etc -> * inference). Legacy
// relation_type stays readable and the projection enum is unchanged.

const root = new URL('../', import.meta.url);
const [
  migration,
  ledger,
  economy,
  admin,
  adminOps,
  reviewContext,
  core,
  complex001
] = await Promise.all([
  readFile(new URL('migrations/048_owner_application_relation_resolution.sql', root), 'utf8'),
  readFile(new URL('migration-safety-ledger.json', root), 'utf8'),
  readFile(new URL('src/resident-economy-v2.ts', root), 'utf8'),
  readFile(new URL('src/admin-v1.ts', root), 'utf8'),
  readFile(new URL('src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('src/admin-review-context-v1.ts', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/001_initial_schema.sql', root), 'utf8')
]);

/* --- 1. migration shape --- */
assert.match(migration, /alter table business_applications alter column relation_type drop not null/i,
  '048 must relax legacy relation_type to nullable');
for (const column of ['relation_raw', 'resolved_relation_type']) {
  assert.ok(migration.includes(`add column if not exists ${column}`),
    `048 must add column ${column}`);
}
assert.match(migration, /relation_raw is null or relation_raw in \('self','co','family','etc'\)/i,
  'relation_raw must be bounded to the four canonical raw values');
assert.match(migration, /resolved_relation_type is null or resolved_relation_type in \('resident','resident_family','neighbor','local'\)/i,
  'resolved_relation_type must be bounded to the existing projection enum');
assert.match(migration, /relation_type is null or relation_type in \('resident','resident_family','neighbor','local'\)/i,
  'the rebuilt legacy check must stay bounded while allowing NULL');
assert.match(migration, /resolved_relation_type = relation_type/i,
  '048 must backfill resolved_relation_type from legacy rows (zero regression)');
assert.match(migration, /when 'resident' then 'self'\s+when 'resident_family' then 'family'/i,
  'raw backfill must use ONLY the safe inverse mapping');
assert.doesNotMatch(migration, /'co'\s*(then|=>)?\s*'neighbor|when 'neighbor' then 'co'/i,
  'co -> neighbor inference is FORBIDDEN in the migration');

/* --- 2. projection enum unchanged everywhere --- */
assert.match(complex001, /relation_type text not null check \(relation_type in \('resident','resident_family','neighbor','local'\)\)/i,
  '001 business_applications projection enum must stay as written (048 only relaxes nullability)');

/* --- 3. ledger registration (production gate read-back) --- */
const ledgerJson = JSON.parse(ledger);
const entry = ledgerJson.migrations['048_owner_application_relation_resolution.sql'];
assert.ok(entry, '048 must be registered in migration-safety-ledger.json');
assert.equal(entry.class, 'schema');
assert.deepEqual(entry.marker, { kind: 'column', table: 'business_applications', name: 'resolved_relation_type' });

/* --- 4. intake: pre-resolve ONLY self / family; co / etc stay unresolved --- */
assert.ok(economy.includes("self: 'resident'"), 'self must pre-resolve to resident');
assert.ok(economy.includes("family: 'resident_family'"), 'family must pre-resolve to resident_family');
assert.doesNotMatch(economy, /co:\s*'(neighbor|local|resident)'/, 'co must never pre-resolve');
assert.doesNotMatch(economy, /etc:\s*'(neighbor|local|resident)'/, 'etc must never pre-resolve');
assert.match(economy, /OWNER_RELATION_RAW_VALUES = \['self', 'co', 'family', 'etc'\]/,
  'intake must validate the four canonical raw values');
assert.match(economy, /Invalid relationRaw/, 'unsupported raw must fail closed with VALIDATION_ERROR');
assert.match(economy, /relationType must be omitted until relationRaw is resolvable/,
  'a smuggled legacy relationType for unresolved raw must be rejected');

/* --- 5. persistence: create + every resubmit variant write the three columns --- */
assert.equal((economy.match(/relation_raw = \$\{input\.relationRaw \|\| null\}/g) ?? []).length, 6,
  'all six resubmit update variants must persist relation_raw');
assert.equal((economy.match(/resolved_relation_type = \$\{input\.resolvedRelationType\}/g) ?? []).length, 6,
  'all six resubmit update variants must persist resolved_relation_type');
assert.equal((economy.match(/\$\{input\.relationType \|\| null\}/g) ?? []).length, 8,
  'create inserts and resubmit updates must store NULL (never empty string) for unresolved relations');
assert.equal((economy.match(/returning id, relation_type, relation_raw, resolved_relation_type/g) ?? []).length, 2,
  'both create inserts must return the resolution columns');
assert.equal((economy.match(/returning a\.id, a\.relation_type, a\.relation_raw, a\.resolved_relation_type/g) ?? []).length, 6,
  'all six resubmit updates must return the resolution columns');

/* --- 6. idempotency fingerprint: legacy bodies hash byte-identically --- */
assert.match(economy, /const canonicalPayload: Record<string, unknown> = \{/,
  'fingerprint must build the canonical body explicitly (stable key order)');
assert.match(economy, /if \(input\.relationRaw\) canonicalPayload\.relationRaw = input\.relationRaw;/,
  'relationRaw must join the fingerprint only when the client sent it');
assert.doesNotMatch(economy, /canonicalPayload\.resolvedRelationType/,
  'derived resolution must never enter the request fingerprint');

/* --- 7. approval fails closed while unresolved (single operational admin lane) ---
 * #372 D1 / #375 F9: the legacy admin-v1 operational handlers are removed;
 * admin-operational-v2 is the only admin approval lane. */
for (const [label, api] of [['admin-operational-v2', adminOps]]) {
  assert.match(api, /and a\.relation_type is not null/, `${label}: UPDATE gate must reject unresolved relation_type`);
  assert.match(api, /and a\.resolved_relation_type is not null/, `${label}: UPDATE gate must reject unresolved resolution`);
  assert.ok(api.includes('RELATION_NOT_RESOLVED'), `${label}: caller must fail closed with RELATION_NOT_RESOLVED`);
  assert.match(api, /a\.relation_type, a\.relation_raw, a\.resolved_relation_type/,
    `${label}: application context must read back the resolution columns`);
  assert.doesNotMatch(api, /business_complex_relations[\s\S]{0,400}relation_raw/,
    `${label}: raw must never leak into business_complex_relations`);
}
assert.match(adminOps, /select a\.approved_business_id, a\.complex_id, a\.relation_type,/,
  'admin-operational-v2 projection insert keeps using the resolved legacy column');
assert.doesNotMatch(admin, /relation_type is not null|RELATION_NOT_RESOLVED|with approved as /,
  'collapsed admin-v1 gate must not retain operational approval/relation gate logic');
assert.match(admin, /Admin route not found/,
  'collapsed admin-v1 gate must remain the terminal 404 for unowned admin routes');

/* --- 8. reviewer read-back is additive --- */
assert.match(reviewContext, /a\.relation_raw,/, 'review context must read relation_raw');
assert.match(reviewContext, /a\.resolved_relation_type,/, 'review context must read resolved_relation_type');
assert.match(reviewContext, /relationRaw: row\.relation_raw,/, 'review context must expose relationRaw');
assert.match(reviewContext, /resolvedRelationType: row\.resolved_relation_type,/, 'review context must expose resolvedRelationType');

/* --- 9. resident read-back exposes the resolution columns --- */
assert.match(core, /a\.relation_type, a\.relation_raw,\s*\n?\s*a\.resolved_relation_type, a\.business_name/,
  'GET /me/business-applications must return relation_raw + resolved_relation_type');

console.log('owner-relation-resolution-contract: PASS');
