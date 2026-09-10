import assert from 'node:assert/strict';
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
