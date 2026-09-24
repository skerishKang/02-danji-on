import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { validateRequestPayload } from '../src/payload-policy.ts';

const root = new URL('../../../', import.meta.url);
const adminPage = readFileSync(new URL('frontend/admin/index.html', root), 'utf8');
const adminBridge = readFileSync(new URL('frontend/assets/danjion-admin-console.js', root), 'utf8');
const backendHandler = readFileSync(new URL('04_개발/backend/src/admin-operational-v2.ts', root), 'utf8');

assert.match(adminPage, /note\.maxLength=1000;note\.placeholder='검토 메모 \(선택\)';note\.setAttribute\('aria-label','검토 메모'\)/,
  'application review note UI maxLength must be 1000');
assert.match(adminPage, /consoleApi\.reviewBusinessApplication\(fetch,apiBase,row\.id,next,note\.value\)/,
  'application review controls must submit the textarea value');
assert.match(adminBridge, /reviewNote: String\(reviewNote \|\| ''\)\.trim\(\) \|\| null/,
  'admin bridge must bind the submitted review note to reviewNote');
assert.match(backendHandler, /const noteText = String\(payload\.reviewNote \?\? ''\)\.trim\(\);/,
  'application review handler must retain the canonical reviewNote binding');
assert.match(backendHandler, /status in \('pending','changes_requested'\)/,
  'application review status transition boundary must remain unchanged');
assert.match(backendHandler, /POLICY\.businessReview/,
  'application review authorization policy must remain unchanged');

const jsonRequest = (payload) => new Request('https://danjion.test/api/v1/admin/business-applications/11111111-1111-1111-1111-111111111111', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload)
});

const atLimit = await validateRequestPayload(jsonRequest({ status: 'approved', reviewNote: '가'.repeat(1000) }), 'req-994');
assert.equal(atLimit, null, 'REVIEW_NOTE_AT_LIMIT_1000=PASS');

const overLimit = await validateRequestPayload(jsonRequest({ status: 'approved', reviewNote: '가'.repeat(1001) }), 'req-994');
assert.ok(overLimit instanceof Response, 'REVIEW_NOTE_OVER_LIMIT_1001=CLIENT_BLOCK_OR_CANONICAL_4XX');
assert.equal(overLimit.status, 400, 'OVER_LIMIT_STATUS=400');
const overBody = await overLimit.json();
assert.equal(overBody.error.code, 'VALIDATION_ERROR', 'OVER_LIMIT_CODE=VALIDATION_ERROR');
assert.equal(overBody.error.message, 'reviewNote must be 1000 characters or fewer');
assert.equal(overBody.requestId, 'req-994');

let captured;
const context = {
  console,
  DanjionSession: {
    joinUrl(base, path) { return String(base || '') + path; },
    async request(fetchImpl, url, options) {
      captured = { fetchImpl, url, options };
      return { ok: true, status: 200, data: { status: 'approved' } };
    }
  }
};
context.window = context;
context.globalThis = context;
runInNewContext(adminBridge, context, { filename: fileURLToPath(new URL('frontend/assets/danjion-admin-console.js', root)) });

for (const status of ['approved', 'changes_requested', 'rejected']) {
  const note = `${status}-검토 메모`;
  const result = await context.DanjionAdminConsole.reviewBusinessApplication(
    async () => {},
    'https://api.danjion.test',
    '11111111-1111-4111-8111-111111111111',
    status,
    note
  );
  assert.equal(result.state, 'updated');
  assert.equal(captured.options.method, 'PATCH');
  const payload = JSON.parse(captured.options.body);
  assert.equal(payload.status, status);
  assert.equal(payload.reviewNote, note);
}

assert.match(adminPage, /function applicationReviewControls\(/,
  'application review UI entry point must remain present');
assert.match(adminPage, /\['approved','승인','primary'/);
assert.match(adminPage, /\['changes_requested','수정요청'/);
assert.match(adminPage, /\['rejected','거절'/);

console.log('admin-review-note-limit-994-contract: PASS');
console.log('REVIEW_NOTE_SERVER_MAX=1000');
console.log('REVIEW_NOTE_UI_MAX=1000');
console.log('REVIEW_NOTE_AT_LIMIT_1000=PASS');
console.log('REVIEW_NOTE_OVER_LIMIT_1001=400_VALIDATION_ERROR');
console.log('APPLICATION_REVIEW_PAYLOAD_BINDING=PASS');
console.log('AUTHZ_UNCHANGED=PASS');
console.log('REVIEW_STATUS_RULES_UNCHANGED=PASS');
