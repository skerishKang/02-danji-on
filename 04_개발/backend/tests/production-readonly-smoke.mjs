import assert from 'node:assert/strict';

const apiBase = String(process.env.DANJION_PRODUCTION_API_URL || '').replace(/\/$/, '');
const complexSlug = 'banglim-myeongji-roadhill';

if (!apiBase) {
  console.error('PRODUCTION_READONLY_SMOKE_INVALID: DANJION_PRODUCTION_API_URL is required');
  process.exit(2);
}

async function getJson(path) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

function expectStatus(result, expected, label) {
  assert.equal(
    result.response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  console.log(`PASS ${label} -> ${expected}`);
}

// Positive public feature smoke: proves canonical production complex authority
// and one real feature collection beyond health/JWKS are reachable.
const complex = await getJson(`/api/v1/complexes/${encodeURIComponent(complexSlug)}`);
expectStatus(complex, 200, 'canonical public complex');
assert.equal(complex.body?.data?.slug, complexSlug, 'production complex slug must match seed 042 authority');
assert.equal(typeof complex.body?.data?.name, 'string');
assert.ok(complex.body.data.name.trim().length > 0, 'production complex must expose a non-empty display name');

const businesses = await getJson(`/api/v1/complexes/${encodeURIComponent(complexSlug)}/businesses?limit=1`);
expectStatus(businesses, 200, 'public business discovery');
assert.ok(Array.isArray(businesses.body?.data), 'public business discovery must return the normal data array envelope');

// Auth-negative checks: representative private/admin routes must exist behind
// the auth boundary without exposing any private production data.
const ownerList = await getJson('/api/v1/me/business-applications');
expectStatus(ownerList, 401, 'owner application list without auth');
assert.equal(ownerList.body?.error?.code, 'AUTH_REQUIRED');

const adminList = await getJson(
  `/api/v1/admin/complexes/${encodeURIComponent(complexSlug)}/business-applications?limit=1`
);
expectStatus(adminList, 401, 'admin application list without auth');
assert.equal(adminList.body?.error?.code, 'AUTH_REQUIRED');

// Recently-added private document route: use syntactically valid but nonexistent
// UUIDs. This route intentionally performs a bound lookup before actor auth so
// a missing/cross-application identity is non-disclosing 404. No bytes can be
// returned and no production row is mutated.
const fakeApplicationId = '11111111-1111-4111-8111-111111111111';
const fakeDocumentId = '22222222-2222-4222-8222-222222222222';
const privateDocument = await getJson(
  `/api/v1/me/business-applications/${fakeApplicationId}/documents/${fakeDocumentId}`
);
expectStatus(privateDocument, 404, 'nonexistent owner private document is non-disclosing');
assert.equal(privateDocument.body?.error?.code, 'NOT_FOUND');

console.log('PASS production read-only feature smoke');
