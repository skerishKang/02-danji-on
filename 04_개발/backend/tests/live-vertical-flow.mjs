import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiBase = process.env.DANJION_PREVIEW_API_URL?.replace(/\/$/, '');
const complexSlug = process.env.DANJION_TEST_COMPLEX_SLUG?.trim();
const residentToken = process.env.DANJION_RESIDENT_BEARER_TOKEN?.trim();
const verificationResidentToken = process.env.DANJION_VERIFICATION_RESIDENT_BEARER_TOKEN?.trim();
const adminToken = process.env.DANJION_ADMIN_BEARER_TOKEN?.trim();

if (process.env.DANJION_API_DB_TARGET !== 'child') {
  console.error("REFUSED: DANJION_API_DB_TARGET must be exactly 'child'. Mutating live E2E never runs against production.");
  process.exit(30);
}

const required = {
  DANJION_PREVIEW_API_URL: apiBase,
  DANJION_TEST_COMPLEX_SLUG: complexSlug,
  DANJION_RESIDENT_BEARER_TOKEN: residentToken,
  DANJION_VERIFICATION_RESIDENT_BEARER_TOKEN: verificationResidentToken,
  DANJION_ADMIN_BEARER_TOKEN: adminToken
};
for (const [name, value] of Object.entries(required)) {
  if (!value) {
    console.error(`BLOCKED: ${name} is required for final live vertical E2E.`);
    process.exit(31);
  }
}

const residentHeaders = { authorization: `Bearer ${residentToken}`, 'content-type': 'application/json' };
const verificationHeaders = { authorization: `Bearer ${verificationResidentToken}`, 'content-type': 'application/json' };
const adminHeaders = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) }
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
    `${label}: expected ${expected}, got ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  console.log(`PASS ${label}`);
}

// Authorization negative: an ordinary resident must never gain manager/admin access.
const residentAdminAttempt = await jsonRequest(
  `/api/v1/admin/complexes/${encodeURIComponent(complexSlug)}/business-applications?limit=1`,
  { headers: residentHeaders }
);
expectStatus(residentAdminAttempt, 403, 'resident denied admin application list');

const suffix = randomUUID().slice(0, 8);
const businessName = `Track D Live ${suffix}`;
const applicationPayload = {
  complexSlug,
  relationType: 'resident',
  businessName,
  categoryName: '생활서비스',
  serviceSummary: 'Track D synthetic live integration service',
  priceText: '30,000원',
  contactMethod: 'phone_sms',
  serviceArea: 'synthetic child branch only',
  benefitText: `Track D benefit ${suffix}`,
  availabilityText: '평일',
  representativeImageObjectKey: null
};

const created = await jsonRequest('/api/v1/me/business-applications', {
  method: 'POST',
  headers: {
    ...residentHeaders,
    'idempotency-key': `track-d:${randomUUID()}`
  },
  body: JSON.stringify(applicationPayload)
});
expectStatus(created, 201, 'resident creates business application');
const applicationId = created.body?.data?.id;
assert.match(String(applicationId), /^[0-9a-f-]{36}$/i, 'application id must be UUID');

const changesRequested = await jsonRequest(`/api/v1/admin/business-applications/${applicationId}`, {
  method: 'PATCH',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'changes_requested', reviewNote: 'Track D synthetic correction request' })
});
expectStatus(changesRequested, 200, 'admin requests changes');

const residentSeesChanges = await jsonRequest(`/api/v1/me/business-applications/${applicationId}`, {
  headers: residentHeaders
});
expectStatus(residentSeesChanges, 200, 'resident reads changes-requested status');
assert.equal(residentSeesChanges.body?.data?.status, 'changes_requested');

const resubmittedPayload = {
  ...applicationPayload,
  serviceArea: 'synthetic child branch only - corrected'
};
delete resubmittedPayload.complexSlug;
const resubmitted = await jsonRequest(`/api/v1/me/business-applications/${applicationId}`, {
  method: 'PATCH',
  headers: residentHeaders,
  body: JSON.stringify(resubmittedPayload)
});
expectStatus(resubmitted, 200, 'resident resubmits corrected application');
assert.equal(resubmitted.body?.data?.status, 'pending');

const approved = await jsonRequest(`/api/v1/admin/business-applications/${applicationId}`, {
  method: 'PATCH',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'approved', reviewNote: 'Track D synthetic approval' })
});
expectStatus(approved, 200, 'admin approves application');

const residentSeesApproved = await jsonRequest(`/api/v1/me/business-applications/${applicationId}`, {
  headers: residentHeaders
});
expectStatus(residentSeesApproved, 200, 'resident sees approved status');
assert.equal(residentSeesApproved.body?.data?.status, 'approved');

const publicSearch = await jsonRequest(
  `/api/v1/complexes/${encodeURIComponent(complexSlug)}/businesses?q=${encodeURIComponent(businessName)}&limit=10`
);
expectStatus(publicSearch, 200, 'approved business is publicly searchable');
const publicBusiness = Array.isArray(publicSearch.body?.data)
  ? publicSearch.body.data.find((item) => item?.name === businessName)
  : null;
assert.ok(publicBusiness, 'approved business must appear in public list');
const businessId = publicBusiness.id;
const benefitId = publicBusiness.active_benefit?.id;
assert.ok(benefitId, 'approved application benefit must materialize as active benefit');

const claimed = await jsonRequest(`/api/v1/me/benefits/${benefitId}/claim`, {
  method: 'POST',
  headers: residentHeaders,
  body: JSON.stringify({ complexSlug })
});
expectStatus(claimed, 200, 'verified resident claims benefit');
assert.equal(claimed.body?.data?.status, 'stored');
assert.match(String(claimed.body?.data?.claim_code ?? ''), /^DANJION-[A-Z0-9]{8}$/);

const used = await jsonRequest(`/api/v1/me/benefits/${benefitId}/use`, {
  method: 'PATCH',
  headers: residentHeaders,
  body: JSON.stringify({})
});
expectStatus(used, 200, 'resident marks benefit used');
assert.equal(used.body?.data?.status, 'used');

// Resident verification: apply -> reject -> reapply -> approve.
const verificationApplied = await jsonRequest(
  `/api/v1/me/complexes/${encodeURIComponent(complexSlug)}/resident-verification`,
  {
    method: 'POST',
    headers: verificationHeaders,
    body: JSON.stringify({ building: '102', unit: '9999', method: 'management_confirmation' })
  }
);
expectStatus(verificationApplied, 201, 'resident verification application');
const verificationId = verificationApplied.body?.data?.verification_id;
assert.match(String(verificationId), /^[0-9a-f-]{36}$/i, 'verification id must be UUID');

const rejected = await jsonRequest(`/api/v1/admin/resident-verifications/${verificationId}`, {
  method: 'PATCH',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'rejected', note: 'Track D synthetic rejection' })
});
expectStatus(rejected, 200, 'admin rejects resident verification');
assert.equal(rejected.body?.data?.verification_status, 'rejected');

const reapplied = await jsonRequest(
  `/api/v1/me/complexes/${encodeURIComponent(complexSlug)}/resident-verification`,
  {
    method: 'POST',
    headers: verificationHeaders,
    body: JSON.stringify({ building: '102', unit: '1202', method: 'management_confirmation' })
  }
);
expectStatus(reapplied, 201, 'rejected resident reapplies');
assert.equal(reapplied.body?.data?.verification_status, 'pending');

const verified = await jsonRequest(`/api/v1/admin/resident-verifications/${verificationId}`, {
  method: 'PATCH',
  headers: adminHeaders,
  body: JSON.stringify({ status: 'verified', note: 'Track D synthetic verification approval' })
});
expectStatus(verified, 200, 'admin approves resident verification');
assert.equal(verified.body?.data?.verification_status, 'verified');
assert.equal(verified.body?.data?.verification_record_status, 'verified');

const verificationState = await jsonRequest(
  `/api/v1/me/complexes/${encodeURIComponent(complexSlug)}/resident-verification`,
  { headers: verificationHeaders }
);
expectStatus(verificationState, 200, 'resident reads verified state');
assert.equal(verificationState.body?.data?.membership?.verification_status, 'verified');
assert.equal(verificationState.body?.data?.verification?.status, 'verified');
assert.equal(verificationState.body?.data?.membership?.building, '102');
assert.equal(verificationState.body?.data?.membership?.unit, '1202');

console.log('\nPASS Track D live vertical flow');
console.log(`Synthetic application: ${applicationId}`);
console.log(`Synthetic business: ${businessId}`);
console.log(`Synthetic resident verification: ${verificationId}`);
console.log('NOTE: run only on a disposable Neon child branch; delete/reset that child branch after the release-gate run.');
