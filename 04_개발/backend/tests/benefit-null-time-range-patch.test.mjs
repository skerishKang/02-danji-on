import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleAdminOperationalRequest } from '../src/admin-operational-v2.ts';

// This test drives the real PATCH route through the test-only Neon shim. It
// proves SQL parameter values as well as the canonical response contract.
const source = await readFile(fileURLToPath(new URL('../src/admin-operational-v2.ts', import.meta.url)), 'utf8');
const adminBridge = await readFile(fileURLToPath(new URL('../../../frontend/assets/danjion-admin-console.js', import.meta.url)), 'utf8');
const patchStart = source.indexOf('async function patchBenefit(');
const patchEnd = source.indexOf('/**', patchStart);
const patchBlock = source.slice(patchStart, patchEnd);
assert.ok(patchStart >= 0 && patchEnd > patchStart, 'patchBenefit source must be discoverable');
assert.match(source, /normalizeBenefitTimestamp/, 'benefit timestamps must be validated before SQL');
assert.match(patchBlock, /payload\.conditions === null \? null/, 'explicit conditions clear must remain null');
assert.match(patchBlock, /effectiveStartsAt/, 'effective start must include current state');
assert.match(patchBlock, /effectiveEndsAt/, 'effective end must include current state');
assert.doesNotMatch(patchBlock, /String\(payload\.startsAt\)|String\(payload\.endsAt\)/, 'timestamp payload must not be stringified');
assert.match(patchBlock, /startsAt must be before or equal to endsAt/, 'reversed effective ranges must be rejected');
assert.match(adminBridge, /conditions: conditions \|\| null/, 'frontend blank conditions must remain an explicit clear');
assert.match(adminBridge, /startsAt: startsAt \|\| null/, 'frontend blank start must remain an explicit clear');
assert.match(adminBridge, /endsAt: endsAt \|\| null/, 'frontend blank end must remain an explicit clear');

const BENEFIT_ID = '97000000-0000-4000-8000-000000000001';
const COMPLEX_ID = '97000000-0000-4000-8000-000000000002';
const COMPLEX_SLUG = 'benefit-test-complex';
const ACTOR_ID = '97000000-0000-4000-8000-000000000003';
const SUBJECT = 'benefit-test-subject';
const ENV = {
  DATABASE_URL: 'postgresql://unused.test',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};
const BASE = {
  id: BENEFIT_ID,
  complex_id: COMPLEX_ID,
  business_id: '97000000-0000-4000-8000-000000000004',
  complex_slug: COMPLEX_SLUG,
  title: 'Existing benefit',
  description: 'Existing description',
  conditions: 'Existing conditions',
  starts_at: '2026-10-10T00:00:00.000Z',
  ends_at: '2026-10-20T00:00:00.000Z',
  status: 'active'
};

function textOf(strings) {
  return strings.join('?').replace(/\s+/g, ' ').trim();
}

function makeSql(current = BASE, { authorized = true } = {}) {
  const seen = [];
  const sql = async (strings, ...values) => {
    const text = textOf(strings);
    seen.push({ text, values });
    if (text.includes('select be.*, c.slug as complex_slug')) return [current];
    if (text.includes('from app_users') && text.includes('where auth_user_id =')) {
      return [{ id: ACTOR_ID, auth_user_id: SUBJECT, display_name: 'Benefit operator', account_status: 'active' }];
    }
    if (text.includes('from complexes c') && text.includes('left join lateral')) {
      return [{
        complex_id: COMPLEX_ID,
        complex_slug: COMPLEX_SLUG,
        padiem_grant_id: authorized ? 'grant-1' : null,
        padiem_granted_scope: authorized ? 'benefit.manage' : null,
        council_grant_id: null,
        council_granted_scope: null
      }];
    }
    if (text.includes('insert into audit_events')) return [];
    if (text.includes('update benefits')) {
      return [{
        id: BENEFIT_ID,
        business_id: current.business_id,
        title: values[0],
        description: values[1],
        conditions: values[2],
        starts_at: values[3],
        ends_at: values[4],
        status: values[5],
        updated_at: '2026-10-01T00:00:00.000Z'
      }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };
  return { sql, seen };
}

function patchRequest(payload) {
  return new Request(`https://api.example.test/api/v1/admin/benefits/${BENEFIT_ID}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-danjion-dev-auth-user': SUBJECT
    },
    body: JSON.stringify(payload)
  });
}

async function runPatch(payload, options = {}) {
  const harness = makeSql(options.current || BASE, options);
  globalThis.__DANJION_TEST_SQL__ = harness.sql;
  try {
    const response = await handleAdminOperationalRequest(patchRequest(payload), ENV, `req-${Math.random().toString(16).slice(2)}`);
    return { response, seen: harness.seen };
  } finally {
    delete globalThis.__DANJION_TEST_SQL__;
  }
}

function updateCall(seen) {
  return seen.find((entry) => entry.text.includes('update benefits'));
}

async function expectPatchOk(payload, expected, options = {}) {
  const { response, seen } = await runPatch(payload, options);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const update = updateCall(seen);
  assert.ok(update, 'valid patch must reach the update query');
  assert.equal(update.values[2], expected.conditions);
  assert.equal(update.values[3], expected.startsAt);
  assert.equal(update.values[4], expected.endsAt);
  for (const value of [update.values[2], update.values[3], update.values[4]]) {
    assert.notEqual(value, 'null');
    assert.notEqual(value, 'undefined');
    assert.notEqual(value, 'Invalid Date');
  }
  return { response, update };
}

async function expectPatchValidation(payload, options = {}) {
  const { response, seen } = await runPatch(payload, options);
  assert.equal(response.status, 400, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(updateCall(seen), undefined, 'invalid patch must not reach the update query');
}

async function expectPatchForbidden(payload, options = {}) {
  const { response, seen } = await runPatch(payload, options);
  assert.equal(response.status, 403, JSON.stringify(await response.clone().json()));
  const body = await response.json();
  assert.equal(body.error.code, 'OPERATIONAL_FORBIDDEN');
  assert.equal(updateCall(seen), undefined, 'unauthorized patch must not reach the update query');
}

// Explicit null is SQL NULL; omitted fields preserve current values.
await expectPatchOk(
  { conditions: null, startsAt: null, endsAt: null },
  { conditions: null, startsAt: null, endsAt: null }
);
await expectPatchOk(
  { title: 'Updated only' },
  { conditions: BASE.conditions, startsAt: BASE.starts_at, endsAt: BASE.ends_at }
);
await expectPatchOk(
  { conditions: '  trimmed conditions  ', startsAt: '2026-10-11T09:00:00+09:00', endsAt: '2026-10-12T00:00:00Z' },
  { conditions: 'trimmed conditions', startsAt: '2026-10-11T00:00:00.000Z', endsAt: '2026-10-12T00:00:00.000Z' }
);
await expectPatchOk(
  { conditions: '   ' },
  { conditions: null, startsAt: BASE.starts_at, endsAt: BASE.ends_at }
);

// Open-ended and equal ranges remain valid.
await expectPatchOk(
  { startsAt: null },
  { conditions: BASE.conditions, startsAt: null, endsAt: BASE.ends_at }
);
await expectPatchOk(
  { endsAt: null },
  { conditions: BASE.conditions, startsAt: BASE.starts_at, endsAt: null }
);
await expectPatchOk(
  { startsAt: null, endsAt: null },
  { conditions: BASE.conditions, startsAt: null, endsAt: null }
);
await expectPatchOk(
  { startsAt: '2026-10-15T00:00:00Z', endsAt: '2026-10-15T00:00:00Z' },
  { conditions: BASE.conditions, startsAt: '2026-10-15T00:00:00.000Z', endsAt: '2026-10-15T00:00:00.000Z' }
);

// Effective merged state catches one-sided and two-sided reversals.
await expectPatchValidation({ startsAt: '2026-10-25T00:00:00Z' });
await expectPatchValidation({ endsAt: '2026-10-01T00:00:00Z' });
await expectPatchValidation({ startsAt: '2026-10-25T00:00:00Z', endsAt: '2026-10-20T00:00:00Z' });

// Invalid timestamp classes are bounded client errors, never DB cast failures.
for (const value of ['not-a-date', '2026-99-99T00:00:00Z', '2026-02-30T00:00:00Z', '2026-10-10T25:00:00Z']) {
  await expectPatchValidation({ startsAt: value });
  await expectPatchValidation({ endsAt: value });
}
await expectPatchOk(
  { startsAt: '', endsAt: '' },
  { conditions: BASE.conditions, startsAt: null, endsAt: null }
);
await expectPatchValidation({ startsAt: 123 });

// The existing authorization gate remains authoritative and fail-closed.
await expectPatchForbidden({ conditions: null }, { authorized: false });

console.log('benefit-null-time-range-patch.test: PASS');
console.log('PATCH_CONDITIONS_NULL=SQL_NULL');
console.log('PATCH_STARTS_AT_NULL=SQL_NULL');
console.log('PATCH_ENDS_AT_NULL=SQL_NULL');
console.log('OMITTED_FIELDS=PRESERVE');
console.log('EFFECTIVE_RANGE_REVERSAL=4XX');
console.log('MALFORMED_TIMESTAMP=4XX_NOT_500');
console.log('AUTHZ_UNCHANGED=PASS');
