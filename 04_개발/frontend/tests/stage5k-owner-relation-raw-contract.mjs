import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createApplicationReportBridge,
  normalizeOwnerApplication
} from '../../../frontend/assets/application-report-bridge.js';

// Issue #341 [owner relation contract]: the owner lane sends the canonical
// raw relation (self|co|family|etc) verbatim. Pre-resolution (self -> resident,
// family -> resident_family) is SERVER-SIDE authority; the bridge must never
// coerce, and co/etc must reach the server unresolved rather than being
// guessed into neighbor/local. The legacy relationType intake path stays
// byte-compatible, and the #314 gallery + #309 report R-B semantics are
// regression-guarded here as well.

const UUID_A = '11111111-1111-4111-8111-111111111111';

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function ownerBridge(calls, echoRow) {
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/me/business-applications') && init.method === 'POST') {
      return response(201, { data: echoRow });
    }
    if (url.includes('/api/v1/me/shop-recommendations') && init.method === 'POST') {
      return response(201, { data: { id: UUID_A, reported_relation_raw: JSON.parse(init.body).relationRaw } });
    }
    throw new Error(`unexpected ${url}`);
  };
  return createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
}

/* --- 1. all four canonical raw values pass through verbatim, unmapped --- */
for (const raw of ['self', 'co', 'family', 'etc']) {
  const calls = [];
  const bridge = ownerBridge(calls, { id: UUID_A, relation_type: null, relation_raw: raw, status: 'pending' });
  const result = await bridge.createOwnerApplication(
    { relationRaw: raw, businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명' },
    { idempotencyKey: `owner-${raw}` }
  );
  assert.equal(result.ok, true, `${raw} must be accepted by the bridge`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.relationRaw, raw, `${raw} must be forwarded verbatim`);
  assert.ok(!('relationType' in body), `${raw} must not be coerced into a legacy relationType`);
}

/* --- 2. unsupported raw values fail closed client-side, no request sent --- */
for (const bad of ['alien', 'neighbor', 'local', '']) {
  const calls = [];
  const bridge = ownerBridge(calls, { id: UUID_A, status: 'pending' });
  const result = await bridge.createOwnerApplication(
    { relationRaw: bad, businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명' }
  );
  assert.equal(result.ok, false, `${JSON.stringify(bad)} must fail validation`);
  assert.equal(result.reason, 'validation-error');
  assert.equal(calls.length, 0, 'no request may leave the bridge for an invalid raw relation');
}

/* --- 3. legacy relationType intake path stays accepted (zero regression) --- */
{
  const calls = [];
  const bridge = ownerBridge(calls, { id: UUID_A, relation_type: 'resident', status: 'pending' });
  const result = await bridge.createOwnerApplication(
    { relationType: 'resident', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명' }
  );
  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.relationType, 'resident');
  assert.ok(!('relationRaw' in body), 'legacy callers must not gain an invented relationRaw');
}

/* --- 4. normalizeOwnerApplication exposes raw + resolution read-back --- */
{
  const row = normalizeOwnerApplication({
    id: UUID_A, relation_type: null, relation_raw: 'co', resolved_relation_type: null, status: 'pending'
  });
  assert.equal(row.relationRaw, 'co');
  assert.equal(row.resolvedRelationType, null);
  const resolved = normalizeOwnerApplication({
    id: UUID_A, relation_type: 'resident', relation_raw: 'self', resolved_relation_type: 'resident', status: 'pending'
  });
  assert.equal(resolved.relationRaw, 'self');
  assert.equal(resolved.resolvedRelationType, 'resident');
  const legacy = normalizeOwnerApplication({ id: UUID_A, relation_type: 'resident', status: 'pending' });
  assert.equal(legacy.relationRaw, null);
  assert.equal(legacy.resolvedRelationType, null);
}

/* --- 5. #314 gallery regression: photoObjectKeys still drive the mirror --- */
{
  const calls = [];
  const bridge = ownerBridge(calls, { id: UUID_A, relation_raw: 'co', status: 'pending' });
  await bridge.createOwnerApplication({
    relationRaw: 'co', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명',
    photoObjectKeys: ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']
  });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.photoObjectKeys, ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']);
  assert.equal(body.representativeImageObjectKey, 'gdrive/public/business-image/a');
}

/* --- 6. #309 report R-B regression: nearby stays raw, never mapped --- */
{
  const calls = [];
  const bridge = ownerBridge(calls, { id: UUID_A, status: 'pending' });
  const result = await bridge.createRecommendation({
    relationRaw: 'nearby', businessName: '이웃 가게', serviceSummary: '정비'
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.relationRaw, 'nearby', 'report lane must keep sending raw verbatim');
  assert.ok(!('relationType' in body));
}

console.log('stage5k-owner-relation-raw-contract: PASS');

/* ===== #809: canonical Production owner submission lane ===== */

/*
 * The owner submit path treated an empty danjionApiBase() as the static/demo lane. Canonical
 * Production serves same-origin, so there danjionApiBase() === '' while
 * DanjionSession.isCanonicalProduction() === true, which blocked a real owner application
 * before uploadBusinessImage()/uploadApplicationDocument() could reach the server.
 */
const ownerPage = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');
const OWNER_DEMO_TOAST = '입력·파일 선택 확인 완료';
const REPORT_DEMO_TOAST = '제보 내용 확인 완료';

/*
 * Extract the guard that immediately precedes a demo toast: the toast text is the stable
 * anchor, so the executable check follows the shipped condition rather than a fixed line.
 */
function extractGuardBefore(source, toastText) {
  const toastAt = source.indexOf(toastText);
  assert.ok(toastAt >= 0, `demo toast not found: ${toastText}`);
  const guardAt = source.lastIndexOf('if(', toastAt);
  assert.ok(guardAt >= 0, 'the demo guard must exist');
  const guardEnd = source.indexOf('){', guardAt);
  assert.ok(guardEnd > guardAt, 'the demo guard must be a complete condition');
  return source.slice(guardAt + 3, guardEnd);
}

function takesDemoReturn(source, toastText, { apiBase, canonicalProduction }) {
  const guard = extractGuardBefore(source, toastText);
  const evaluate = new Function('danjionApiBase', 'DanjionSession', 'return Boolean(' + guard + ');');
  return evaluate(() => apiBase, { isCanonicalProduction: () => canonicalProduction });
}

function assertOwnerCanonicalServerPath(source) {
  if (takesDemoReturn(source, OWNER_DEMO_TOAST, { apiBase: '', canonicalProduction: true })) {
    throw new Error('OWNER_CANONICAL_PRODUCTION_SERVER_PATH: canonical production must not take the owner demo return');
  }
  return true;
}

/* A. canonical Production, empty base -> owner server path. */
assert.equal(assertOwnerCanonicalServerPath(ownerPage), true);
assert.equal(takesDemoReturn(ownerPage, OWNER_DEMO_TOAST, { apiBase: '', canonicalProduction: true }), false,
  'canonical Production must reach uploadBusinessImage/uploadApplicationDocument');
/* B. static/demo lane -> the demo return is still taken. */
assert.equal(takesDemoReturn(ownerPage, OWNER_DEMO_TOAST, { apiBase: '', canonicalProduction: false }), true,
  'OWNER_DEMO_FALLBACK: the static lane keeps the review-only notice');
/* C. an explicit api base -> owner server path. */
assert.equal(takesDemoReturn(ownerPage, OWNER_DEMO_TOAST, { apiBase: 'https://api.example', canonicalProduction: false }), false,
  'an explicit api base always reaches the server');

/* The owner toast may only sit behind the canonical-aware guard. */
assert.equal(ownerPage.split('!danjionApiBase()&&!DanjionSession.isCanonicalProduction()').length - 1, 2,
  'the report lane (#830) and the owner lane (#809) both keep the canonical-aware guard');
const ownerGuardAt = ownerPage.indexOf(OWNER_DEMO_TOAST);
assert.ok(ownerGuardAt > ownerPage.indexOf('async function submitReport('), 'the owner lane stays separate from submitReport');

/* #830 must not regress: the report lane keeps its canonical Production semantics. */
assert.equal(takesDemoReturn(ownerPage, REPORT_DEMO_TOAST, { apiBase: '', canonicalProduction: true }), false,
  'OWNER_REPORT_PATH_REGRESSION: the report lane still reaches the server on canonical Production');
assert.equal(takesDemoReturn(ownerPage, REPORT_DEMO_TOAST, { apiBase: '', canonicalProduction: false }), true,
  'the report demo fallback is unchanged');

/* Executable mutation proof: dropping the canonical disjunct must make the verifier throw. */
const OWNER_CANONICAL_DISJUNCT = '&&!DanjionSession.isCanonicalProduction()';
const ownerGuardText = extractGuardBefore(ownerPage, OWNER_DEMO_TOAST);
assert.ok(ownerGuardText.includes(OWNER_CANONICAL_DISJUNCT), 'the owner guard must carry the canonical disjunct');
/* Positional mutation: the report lane (#830) carries the same guard text, so a plain string
   replace would mutate the wrong lane and the proof would not bite. */
const ownerToastAt = ownerPage.indexOf(OWNER_DEMO_TOAST);
const ownerGuardStart = ownerPage.lastIndexOf('if(', ownerToastAt);
const ownerGuardEnd = ownerPage.indexOf('){', ownerGuardStart);
assert.ok(ownerGuardStart >= 0 && ownerGuardEnd > ownerGuardStart, 'the owner guard must be locatable');
const legacyOwnerGuard = ownerGuardText.replace(OWNER_CANONICAL_DISJUNCT, '');
const mutatedOwnerPage = ownerPage.slice(0, ownerGuardStart) + `if(${legacyOwnerGuard}` + ownerPage.slice(ownerGuardEnd);
assert.notEqual(mutatedOwnerPage, ownerPage, 'the mutation must actually change the owner guard');
assert.equal(mutatedOwnerPage.includes(OWNER_DEMO_TOAST), true, 'the mutated page must keep the owner toast');
assert.equal(extractGuardBefore(mutatedOwnerPage, OWNER_DEMO_TOAST), legacyOwnerGuard,
  'the mutation must apply to the owner lane only');
assert.equal(extractGuardBefore(mutatedOwnerPage, REPORT_DEMO_TOAST),
  '!danjionApiBase()&&!DanjionSession.isCanonicalProduction()',
  'the report lane must stay canonical-aware in the mutated source');
assert.throws(() => assertOwnerCanonicalServerPath(mutatedOwnerPage), /OWNER_CANONICAL_PRODUCTION_SERVER_PATH/,
  'OWNER_CANONICAL_PRODUCTION_MUTATION_PROOF: the verifier must throw when the canonical semantics are removed');

process.stdout.write('OWNER_CANONICAL_PRODUCTION_SERVER_PATH=PASS\n');
process.stdout.write('OWNER_DEMO_FALLBACK=PASS\n');
process.stdout.write('OWNER_CANONICAL_PRODUCTION_MUTATION_PROOF=PASS\n');
process.stdout.write('OWNER_REPORT_PATH_REGRESSION=PASS\n');
