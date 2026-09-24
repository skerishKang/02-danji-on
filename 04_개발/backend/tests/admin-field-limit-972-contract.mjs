// Issue #972 — runtime boundary proof for the authoritative Admin payload limits.
//
// `validateRequestPayload` (src/payload-policy.ts) is the shared pre-handler gate for every
// /api/v1/ JSON POST/PATCH/PUT, so it is the single authority for the Admin official-news and
// benefit field lengths. This test exercises the REAL function (not a source grep):
//
//   AT_LIMIT_<FIELD>=PASS            max chars passes the gate
//   OVER_LIMIT_<FIELD>=CANONICAL_4XX max+1 chars -> 400 VALIDATION_ERROR (bounded error body)
//
// It also pins the numbers so this lane can never widen the server policy, and pins the static
// Admin UI maxLength to the same numbers so a UI revert fails here too.
//
// No network, no DB, no production mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRequestPayload } from '../src/payload-policy.ts';

const root = new URL('../../../', import.meta.url);
const adminSrc = readFileSync(new URL('frontend/admin/index.html', root), 'utf8');

const jsonRequest = (method, pathname, payload) => new Request(`https://danjion.test${pathname}`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload)
});

const gate = (method, pathname, payload) => validateRequestPayload(jsonRequest(method, pathname, payload), 'req-972');

const repeat = (char, length) => char.repeat(length);

/* ---------------- (1) server-authoritative boundary: max PASS, max+1 REFUSED ---------------- */

const boundaries = [
  ['OFFICIAL_NEWS_TITLE', 'title', 160],
  ['BENEFIT_TITLE', 'title', 160],
  ['BENEFIT_DESCRIPTION', 'description', 2000],
  ['BENEFIT_CONDITIONS', 'conditions', 1000],
  ['OFFICIAL_NEWS_BODY', 'body', 10000]
];

for (const [name, field, max] of boundaries) {
  const path = field === 'body' || field === 'title'
    ? '/api/v1/admin/posts/11111111-1111-1111-1111-111111111111'
    : '/api/v1/admin/benefits/22222222-2222-2222-2222-222222222222';
  const method = 'PATCH';

  const atLimit = await gate(method, path, { [field]: repeat('가', max) });
  assert.equal(atLimit, null, `AT_LIMIT_${name}=PASS (${max} chars must pass the shared gate)`);

  const overLimit = await gate(method, path, { [field]: repeat('가', max + 1) });
  assert.ok(overLimit instanceof Response, `OVER_LIMIT_${name}=CANONICAL_4XX (${max + 1} chars must be refused)`);
  assert.equal(overLimit.status, 400, `OVER_LIMIT_${name} must be a canonical 400`);
  const body = await overLimit.clone().json();
  assert.equal(body.error.code, 'VALIDATION_ERROR', `OVER_LIMIT_${name} error code`);
  assert.match(String(body.error.message), new RegExp(`^${field} must be ${max} characters or fewer$`),
    `OVER_LIMIT_${name} error message must name the authoritative limit`);
  assert.equal(body.requestId, 'req-972', `OVER_LIMIT_${name} must echo the request id`);
}

/* ---------------- (2) real Admin create payloads at the limit ---------------- */

// Official news create: POST /api/v1/admin/complexes/:slug/posts
const officialNewsAtLimit = await gate('POST', '/api/v1/admin/complexes/bangnim-road-hill/posts', {
  sourceName: '단지온 운영자',
  category: repeat('가', 80),
  title: repeat('가', 160),
  body: repeat('가', 10000),
  status: 'draft',
  channel: 'apartment_news',
  displayMode: 'highlight'
});
assert.equal(officialNewsAtLimit, null, 'AT_LIMIT_OFFICIAL_NEWS_TITLE=PASS with the full create payload');

const officialNewsOver = await gate('POST', '/api/v1/admin/complexes/bangnim-road-hill/posts', {
  sourceName: '단지온 운영자',
  category: repeat('가', 80),
  title: repeat('가', 161),
  body: repeat('가', 10000),
  status: 'draft',
  channel: 'apartment_news',
  displayMode: 'highlight'
});
assert.equal(officialNewsOver?.status, 400, 'OVER_LIMIT_OFFICIAL_NEWS_TITLE=CLIENT_BLOCK_OR_CANONICAL_4XX');

// Benefit create: POST /api/v1/admin/complexes/:slug/benefits
const benefitAtLimit = await gate('POST', '/api/v1/admin/complexes/bangnim-road-hill/benefits', {
  businessId: '33333333-3333-3333-3333-333333333333',
  title: repeat('가', 160),
  description: repeat('가', 2000),
  conditions: repeat('가', 1000),
  status: 'draft'
});
assert.equal(benefitAtLimit, null, 'AT_LIMIT_BENEFIT_* =PASS with the full create payload');

for (const [field, max, label] of [
  ['title', 160, 'OVER_LIMIT_BENEFIT_TITLE'],
  ['description', 2000, 'OVER_LIMIT_BENEFIT_DESCRIPTION'],
  ['conditions', 1000, 'OVER_LIMIT_BENEFIT_CONDITIONS']
]) {
  const refused = await gate('POST', '/api/v1/admin/complexes/bangnim-road-hill/benefits', {
    businessId: '33333333-3333-3333-3333-333333333333',
    title: repeat('가', 160),
    description: repeat('가', 2000),
    conditions: repeat('가', 1000),
    status: 'draft',
    [field]: repeat('가', max + 1)
  });
  assert.equal(refused?.status, 400, `${label}=CLIENT_BLOCK_OR_CANONICAL_4XX`);
}

/* ---------------- (3) the visible Admin UI is bounded by the same numbers ---------------- */

const uiMaxByLabel = new Map();
for (const line of adminSrc.split('\n')) {
  const max = line.match(/\.maxLength=(\d+)/);
  const label = line.match(/aria-label','([^']+)'/);
  if (max && label) uiMaxByLabel.set(label[1], Number(max[1]));
}

// #970_SEMANTICS_PRESERVED: this test only reads the static Admin form limits. It asserts nothing
// about the benefit nullable/timestamp semantics owned by #970 / PR #991.
for (const [label, expected] of [
  ['소식 제목', 160],
  ['혜택 제목', 160],
  ['혜택 설명', 2000],
  ['이용 조건', 1000]
]) {
  assert.equal(uiMaxByLabel.get(label), expected,
    `UI_MAX('${label}') must equal the authoritative server limit ${expected}`);
}

process.stdout.write('admin-field-limit-972-contract: PASS\n');
