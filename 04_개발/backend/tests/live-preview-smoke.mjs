import assert from 'node:assert/strict';

const apiBase = process.env.DANJION_PREVIEW_API_URL?.replace(/\/$/, '');
const complexSlug = process.env.DANJION_TEST_COMPLEX_SLUG?.trim();
const residentToken = process.env.DANJION_RESIDENT_BEARER_TOKEN?.trim();
const adminToken = process.env.DANJION_ADMIN_BEARER_TOKEN?.trim();
const mode = process.env.DANJION_GATE_MODE === 'release' ? 'release' : 'prepare';

if (!apiBase) {
  console.error('BLOCKED_TRACK_B: DANJION_PREVIEW_API_URL is not configured.');
  process.exit(mode === 'release' ? 2 : 0);
}

const blocked = [];

async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers ?? {})
    }
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

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

function expectStatus(result, expected, label) {
  assert.equal(
    result.response.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  console.log(`PASS ${label} -> ${expected}`);
}

const health = await request('/api/health');
expectStatus(health, 200, 'public /api/health');
assert.equal(health.body?.data?.status, 'ok', 'health payload must report status=ok');
assert.equal(health.body?.data?.database, 'ok', 'health payload must report database=ok');

const unauthMe = await request('/api/v1/me');
expectStatus(unauthMe, 401, 'private /api/v1/me without auth');
assert.equal(unauthMe.body?.error?.code, 'AUTH_REQUIRED');

const unauthAdmin = await request(`/api/v1/admin/complexes/${encodeURIComponent(complexSlug || 'track-d-missing')}/business-applications`);
expectStatus(unauthAdmin, 401, 'admin application list without auth');
assert.equal(unauthAdmin.body?.error?.code, 'AUTH_REQUIRED');

const invalidAuth = await request('/api/v1/me', {
  headers: { authorization: 'Bearer danjion-track-d-invalid-token' }
});
if (invalidAuth.response.status === 501 && invalidAuth.body?.error?.code === 'AUTH_ADAPTER_PENDING') {
  blocked.push('TRACK_A: invalid-token auth adapter behavior is still AUTH_ADAPTER_PENDING');
  console.log('BLOCKED_TRACK_A invalid bearer token still reaches AUTH_ADAPTER_PENDING');
} else {
  expectStatus(invalidAuth, 401, 'invalid bearer token');
}

if (residentToken) {
  const residentMe = await request('/api/v1/me', { headers: authHeaders(residentToken) });
  expectStatus(residentMe, 200, 'valid resident auth');
} else {
  blocked.push('TRACK_A: DANJION_RESIDENT_BEARER_TOKEN not configured');
  console.log('BLOCKED_TRACK_A valid resident auth smoke token missing');
}

if (adminToken && complexSlug) {
  const adminList = await request(`/api/v1/admin/complexes/${encodeURIComponent(complexSlug)}/business-applications?limit=1`, {
    headers: authHeaders(adminToken)
  });
  expectStatus(adminList, 200, 'valid verified manager/admin auth');
} else {
  blocked.push('TRACK_A: admin token and/or synthetic complex slug not configured');
  console.log('BLOCKED_TRACK_A valid admin authorization smoke inputs missing');
}

if (complexSlug) {
  const publicComplex = await request(`/api/v1/complexes/${encodeURIComponent(complexSlug)}`);
  expectStatus(publicComplex, 200, 'public complex read');
} else {
  blocked.push('TRACK_D_FIXTURE: DANJION_TEST_COMPLEX_SLUG not configured');
  console.log('BLOCKED_TRACK_D_FIXTURE positive public complex read needs a synthetic child-branch fixture');
}

if (blocked.length) {
  console.log('\nBLOCKED items:');
  for (const item of blocked) console.log(`- ${item}`);
  if (mode === 'release') process.exit(3);
} else {
  console.log('\nPASS preview API smoke/auth-negative gate');
}
