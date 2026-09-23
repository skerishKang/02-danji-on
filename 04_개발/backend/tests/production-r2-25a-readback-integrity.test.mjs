/**
 * #955 offline executable regression test for Production 25A public-object readback integrity.
 *
 * Runs the REAL helpers from scripts/production-r2-25a-acceptance.mjs against deterministic
 * Response fixtures. No network, no Production, no mutation.
 *
 * Proves that HTTP 200 alone is never enough: truncated, same-length-wrong-bytes, empty and
 * unsafe-content-type responses must all fail closed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  png,
  mediaType,
  sha256Hex,
  rawReadback,
  evaluateReadbackIntegrity,
  verifyPublicReadback,
  SAFE_READBACK_MEDIA_TYPES,
  FIXTURE_EXPECTED_BYTE_LENGTH,
  FIXTURE_EXPECTED_SHA256,
} from '../scripts/production-r2-25a-acceptance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scriptSource = readFileSync(join(here, '..', 'scripts', 'production-r2-25a-acceptance.mjs'), 'utf8');

// --- fixture stability ---------------------------------------------------
const expected = png();
assert.equal(expected.byteLength, FIXTURE_EXPECTED_BYTE_LENGTH, 'synthetic PNG fixture length drifted');
assert.equal(sha256Hex(expected), FIXTURE_EXPECTED_SHA256, 'synthetic PNG fixture bytes drifted');
assert.ok(SAFE_READBACK_MEDIA_TYPES.includes('image/png'), 'image/png must be a safe readback media type');
console.log('UPLOAD_FIXTURE_BYTES_STABLE=PASS');

// The fixture is not JSON. This is exactly why the pre-#955 generic helper
// (`response.json().catch(() => null)`) silently discarded the readback body.
assert.throws(() => JSON.parse(Buffer.from(expected).toString('utf8')));
assert.ok(scriptSource.includes('arrayBuffer()'), 'readback must capture raw bytes');
assert.ok(!/readback\s*=\s*await request\(/.test(scriptSource), 'readback must not go through the JSON request helper');

// --- deterministic Response fixtures ------------------------------------
const stubFetch = (body, status, contentType) => async () =>
  new Response(body, { status, headers: { 'content-type': contentType } });

const URL_UNDER_TEST = 'https://padiem-danjion-api-production.padiem.workers.dev/api/v1/storage/public?objectKey=gdrive%2Fpublic%2Fbusiness-image%2Ffixture';

// CASE 1 — 200, exact bytes, correct content type -> PASS
{
  const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(expected, 200, 'image/png'));
  assert.deepEqual(
    { ok: result.ok, failure: result.failure },
    { ok: true, failure: null },
    'CASE1 good readback must pass',
  );
  assert.equal(result.checks.http200, true);
  assert.equal(result.checks.contentTypeSafe, true);
  assert.equal(result.checks.byteLengthMatch, true);
  assert.equal(result.checks.sha256Match, true);
  console.log('CASE1_GOOD_200_PASSES=PASS');
}

// raw readback must return the exact uploaded bytes, undecoded
{
  const readback = await rawReadback(URL_UNDER_TEST, {}, stubFetch(expected, 200, 'image/png'));
  assert.equal(readback.status, 200);
  assert.equal(readback.contentType, 'image/png');
  assert.equal(readback.bytes.byteLength, expected.byteLength);
  assert.equal(sha256Hex(readback.bytes), FIXTURE_EXPECTED_SHA256, 'raw readback must preserve exact bytes');
  console.log('RAW_READBACK_CAPTURES_EXACT_BYTES=PASS');
}

// CASE 2 — 200, truncated body -> FAIL
{
  const truncated = expected.slice(0, expected.byteLength - 1);
  const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(truncated, 200, 'image/png'));
  assert.equal(result.ok, false, 'truncated 200 must fail closed');
  assert.equal(result.failure, 'READBACK_BYTE_LENGTH_MISMATCH');
  assert.equal(result.checks.byteLengthMatch, false);
  console.log('TRUNCATED_200_FAILS_CLOSED=PASS');
}

// CASE 3 — 200, same length but one byte different -> FAIL
{
  const tampered = Uint8Array.from(expected);
  tampered[20] ^= 0xff;
  assert.equal(tampered.byteLength, expected.byteLength, 'tampered fixture must keep the same length');
  assert.notEqual(sha256Hex(tampered), FIXTURE_EXPECTED_SHA256, 'tampered fixture must hash differently');
  const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(tampered, 200, 'image/png'));
  assert.equal(result.ok, false, 'same-length wrong bytes must fail closed');
  assert.equal(result.failure, 'READBACK_SHA256_MISMATCH');
  assert.equal(result.checks.byteLengthMatch, true, 'length alone must not be mistaken for integrity');
  assert.equal(result.checks.sha256Match, false);
  console.log('SAME_LENGTH_WRONG_BYTES_FAILS_CLOSED=PASS');
  console.log('MISMATCH_200_FAILS_CLOSED=PASS');
}

// CASE 4 — 200, empty body -> FAIL
{
  const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(new Uint8Array(0), 200, 'image/png'));
  assert.equal(result.ok, false, 'empty 200 must fail closed');
  assert.equal(result.failure, 'READBACK_EMPTY_BODY');
  console.log('EMPTY_200_FAILS_CLOSED=PASS');
}

// CASE 5 — HTTP != 200 -> FAIL
{
  for (const status of [404, 500]) {
    const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(expected, status, 'application/json'));
    assert.equal(result.ok, false, `HTTP ${status} must fail closed`);
    assert.equal(result.failure, `READBACK_HTTP_${status}`);
  }
  console.log('HTTP_FAILURE_FAILS_CLOSED=PASS');
}

// CASE 6 — 200, unsafe/wrong content type -> FAIL
{
  for (const contentType of ['text/html; charset=utf-8', 'application/json', 'application/octet-stream', '']) {
    const result = await verifyPublicReadback(URL_UNDER_TEST, {}, expected, stubFetch(expected, 200, contentType));
    assert.equal(result.ok, false, `content-type "${contentType}" must fail closed`);
    assert.equal(result.failure, 'READBACK_CONTENT_TYPE_UNSAFE');
  }
  // safe content type contract: parameters are tolerated, the media type itself is not negotiable
  assert.equal(mediaType('IMAGE/PNG; charset=binary'), 'image/png');
  assert.equal(mediaType(' image/png '), 'image/png');
  assert.notEqual(mediaType('text/html'), 'image/png');
  console.log('WRONG_CONTENT_TYPE_FAILS_CLOSED=PASS');
  console.log('PUBLIC_READBACK_CONTENT_TYPE_SAFE=PASS');
}

// evaluateReadbackIntegrity must be usable without I/O (pure boundary)
{
  const pure = evaluateReadbackIntegrity(
    { status: 200, contentType: 'image/png', bytes: expected },
    expected,
  );
  assert.equal(pure.ok, true);
  assert.equal(pure.failure, null);
  console.log('PURE_INTEGRITY_EVALUATOR=PASS');
}

console.log('production-r2-25a-readback-integrity: PASS');
