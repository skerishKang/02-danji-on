// Issue #972 — Admin field limits must equal the SERVER-authoritative payload policy.
//
// The backend pre-handler gate (04_개발/backend/src/payload-policy.ts, `validateRequestPayload`,
// mounted in app.ts BEFORE handleAdminOperationalRequest) refuses a JSON body whose shared
// field is one character over FIELD_LIMITS with 400 VALIDATION_ERROR. The static Admin UI
// (frontend/admin/index.html) used to advertise wider inputs, so an operator could complete a
// form the UI presented as valid and still be rejected by the server.
//
// This contract pins the visible maxLength to the server limit for every affected field:
//
//   OFFICIAL_NEWS_TITLE_UI_MAX   = SERVER_MAX   (title)
//   BENEFIT_TITLE_UI_MAX         = SERVER_MAX   (title)
//   BENEFIT_DESCRIPTION_UI_MAX   = SERVER_MAX   (description)
//   BENEFIT_CONDITIONS_UI_MAX    = SERVER_MAX   (conditions)
//
// MUTATION PROOF: the expected numbers below are hard-coded. Reverting the UI maxLength to the
// old 200 / 10000 / 4000 values (or re-widening the server policy) fails this contract.
//
// Zero dependencies, no network, no DB, no production mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (relative) => readFileSync(new URL(relative, root), 'utf8');

const policySrc = read('04_개발/backend/src/payload-policy.ts');
const appSrc = read('04_개발/backend/src/app.ts');
const adminSrc = read('frontend/admin/index.html');
const adminConsoleSrc = read('frontend/assets/danjion-admin-console.js');

/* ---------------- (1) server-authoritative limits ---------------- */

const blockStart = policySrc.indexOf('const FIELD_LIMITS');
assert.ok(blockStart > 0, 'payload-policy.ts must still declare FIELD_LIMITS');
const block = policySrc.slice(blockStart, policySrc.indexOf('};', blockStart));
const serverLimits = Object.fromEntries(
  [...block.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])
);

// SERVER_LIMIT_UNCHANGED_OR_JUSTIFIED=YES: this lane narrows the UI, never the server.
assert.equal(serverLimits.title, 160, 'server title limit drifted (#972 must not widen it)');
assert.equal(serverLimits.description, 2000, 'server description limit drifted');
assert.equal(serverLimits.conditions, 1000, 'server conditions limit drifted');
assert.equal(serverLimits.body, 10000, 'server body limit drifted');

/* ---------------- (2) the gate really is pre-handler and authoritative ---------------- */

const gateIndex = appSrc.indexOf('validateRequestPayload(request, id)');
const adminIndex = appSrc.indexOf('handleAdminOperationalRequest(request, env, id)');
assert.ok(gateIndex > 0, 'app.ts must mount the shared payload gate');
assert.ok(adminIndex > gateIndex, 'OVER_LIMIT=CANONICAL_4XX: the payload gate must run before the admin handlers');

/* ---------------- (3) visible Admin form limits ---------------- */

// Every control is built on a single line as `<name>.maxLength=<n>; ... aria-label','<label>'`.
const uiMaxByLabel = new Map();
for (const line of adminSrc.split('\n')) {
  const max = line.match(/\.maxLength=(\d+)/);
  const label = line.match(/aria-label','([^']+)'/);
  if (max && label) uiMaxByLabel.set(label[1], Number(max[1]));
}
const uiMax = (label) => {
  const value = uiMaxByLabel.get(label);
  assert.equal(typeof value, 'number', `the Admin form must still bound '${label}' with maxLength`);
  return value;
};

const aligned = [
  ['OFFICIAL_NEWS_TITLE_UI_MAX', '소식 제목', 'title', 160],
  ['BENEFIT_TITLE_UI_MAX', '혜택 제목', 'title', 160],
  ['BENEFIT_DESCRIPTION_UI_MAX', '혜택 설명', 'description', 2000],
  ['BENEFIT_CONDITIONS_UI_MAX', '이용 조건', 'conditions', 1000],
  ['OFFICIAL_NEWS_BODY_UI_MAX', '소식 본문', 'body', 10000]
];
for (const [name, label, field, expected] of aligned) {
  assert.equal(uiMax(label), serverLimits[field], `${name}=SERVER_MAX (${field})`);
  assert.equal(uiMax(label), expected, `${name} must be ${expected} (#972 canonical value)`);
}

/* ---------------- (4) the bounded values are the ones actually submitted ---------------- */

const postPayload = adminSrc.slice(adminSrc.indexOf('function postPayload('));
assert.ok(postPayload.startsWith('function postPayload('), 'postPayload must exist');
assert.ok(postPayload.slice(0, 300).includes('title:fields.title.value'), 'the official-news payload submits the bounded title control');
assert.ok(postPayload.slice(0, 300).includes('body:fields.body.value'), 'the official-news payload submits the bounded body control');

const benefitPayload = adminSrc.slice(adminSrc.indexOf('function benefitPayload('));
assert.ok(benefitPayload.startsWith('function benefitPayload('), 'benefitPayload must exist');
for (const binding of ['title:fields.title.value', 'description:fields.description.value', 'conditions:fields.conditions.value']) {
  assert.ok(benefitPayload.slice(0, 400).includes(binding), `the benefit payload submits ${binding}`);
}

/* ---------------- (5) no copy advertises a stale limit ---------------- */

// SINGLE_BOUND_OWNER: the visible bounds live in admin/index.html only. The Admin API transport
// module must not carry its own input bound that could silently widen a form control again.
assert.doesNotMatch(adminConsoleSrc, /\.maxLength\s*=/, 'danjion-admin-console.js must not own input bounds');

assert.doesNotMatch(
  adminSrc,
  /(?:^|[^\d])(?:200|4000|10000)\s*자(?![가-힣])/,
  'COUNTER_COPY_ALIGNED: no Admin copy may advertise the pre-#972 limits'
);

process.stdout.write('leaf-b972-admin-field-limit-alignment-contract: PASS\n');
