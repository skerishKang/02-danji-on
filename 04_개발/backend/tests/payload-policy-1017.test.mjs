import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readBoundedJsonBody, validateRequestPayload } from '../src/payload-policy.ts';

const requestId = 'req-1017';
const path = 'http://localhost/api/v1/test';

function jsonRequest(body, { contentType = 'application/json', contentLength, method = 'POST' } = {}) {
  const headers = new Headers({ 'content-type': contentType });
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Request(path, { method, headers, body });
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), 1000))
  ]);
}

function responseCode(response) {
  return response.status;
}

async function responseError(response) {
  return (await response.json()).error.code;
}

for (const method of ['POST', 'PATCH']) {
  const response = await withTimeout(
    validateRequestPayload(new Request(path, { method }), requestId),
    `BODYLESS_${method}`
  );
  assert.equal(response, null);
  console.log(`BODYLESS_${method}_PARITY=PASS`);
}

{
  const response = await validateRequestPayload(
    jsonRequest(JSON.stringify({ ok: true }), { contentType: 'text/plain' }),
    requestId
  );
  assert.equal(responseCode(response), 415);
  assert.equal(await responseError(response), 'CONTENT_TYPE_REQUIRED');
  console.log('TEXT_PLAIN_WITH_JSON_BODY=415');
}

{
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(70 * 1024)));
      controller.enqueue(new TextEncoder().encode('y'.repeat(70 * 1024)));
      controller.close();
    }
  });
  const request = new Request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1' },
    body: stream,
    duplex: 'half'
  });
  const response = await withTimeout(validateRequestPayload(request, requestId), 'SHARED_GATE_HANG');
  assert.equal(responseCode(response), 413);
  console.log('SHARED_GATE_OVERSIZED_STREAM=413');
  console.log('DISHONEST_SMALL_CONTENT_LENGTH=413');
  console.log('SHARED_GATE_HANG=NO');
}

{
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(70 * 1024)));
      controller.enqueue(new TextEncoder().encode('y'.repeat(70 * 1024)));
      controller.close();
    }
  });
  const request = new Request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half'
  });
  const response = await withTimeout(validateRequestPayload(request, requestId), 'MISSING_CONTENT_LENGTH');
  assert.equal(responseCode(response), 413);
  console.log('MISSING_CONTENT_LENGTH_OVERSIZE=413');
}

{
  const body = JSON.stringify({ ok: true });
  const result = await readBoundedJsonBody(jsonRequest(body), requestId, body.length);
  assert.deepEqual(result, { ok: true });
}

{
  const body = JSON.stringify({ value: 'x'.repeat(40) });
  const response = await readBoundedJsonBody(jsonRequest(body), requestId, 8);
  assert.equal(responseCode(response), 413);
  assert.equal(await responseError(response), 'PAYLOAD_TOO_LARGE');
}

{
  const body = JSON.stringify({ value: 'x'.repeat(40) });
  const response = await readBoundedJsonBody(jsonRequest(body, { contentLength: 1 }), requestId, 8);
  assert.equal(responseCode(response), 413);
}

{
  const response = await readBoundedJsonBody(
    jsonRequest(JSON.stringify({ value: 'x' }), { contentLength: 999 }),
    requestId,
    8
  );
  assert.equal(responseCode(response), 413);
}

{
  const response = await readBoundedJsonBody(
    jsonRequest(JSON.stringify({ value: 'x' }), { contentType: 'text/plain' }),
    requestId,
    128
  );
  assert.equal(responseCode(response), 415);
  assert.equal(await responseError(response), 'CONTENT_TYPE_REQUIRED');
}

{
  const response = await readBoundedJsonBody(jsonRequest('{not-json'), requestId, 128);
  assert.equal(responseCode(response), 400);
  assert.equal(await responseError(response), 'INVALID_JSON');
}

{
  const response = await validateRequestPayload(
    jsonRequest(JSON.stringify({ title: 'x'.repeat(161) })),
    requestId
  );
  assert.equal(responseCode(response), 400);
  assert.equal(await responseError(response), 'VALIDATION_ERROR');
}

{
  const response = await validateRequestPayload(
    jsonRequest(JSON.stringify({ title: 'x'.repeat(161) }), { contentType: 'text/plain' }),
    requestId
  );
  assert.equal(responseCode(response), 415);
}

const downstream = await Promise.all([
  'community-resident-v1.ts',
  'benefit-claim-v1.ts',
  'resident-economy-v2.ts',
  'community-moderation-v1.ts'
].map(async (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')));

for (const source of downstream) {
  assert.match(source, /readBoundedJsonBody/);
  assert.doesNotMatch(source, /request\.json\(\)/);
}

console.log('PASS Issue #1017 preparse JSON bounds and content-type contract');
