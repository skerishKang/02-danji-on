import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../25_1대1문의.html', import.meta.url), 'utf8');
const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');

assert.equal(page.includes('yeo•••@gmail.com'), false,
  'inquiry reply notice must never show the old hardcoded demo email');
assert.ok(page.includes('data-reply-email') &&
          page.includes('가입 이메일 확인 중…'),
  'reply notice must expose a dedicated live session-email slot');
assert.ok(page.includes("session.fetchSession(fetch)"),
  'inquiry page must resolve the canonical authenticated session');
assert.ok(page.includes("result.raw&&result.raw.user&&result.raw.user.email"),
  'reply notice must source email only from the authenticated session user');
assert.ok(page.includes("session.maskEmailAddress(email)"),
  'reply notice must use the shared privacy-safe email masker');
assert.ok(page.includes("const fallback='가입 이메일 확인 불가'"),
  'missing/invalid session email must fail closed with neutral copy');
assert.equal(page.includes('listAccounts'), false,
  'reply notification email must not be inferred from linked/social provider account metadata');

assert.ok(session.includes('function maskEmailAddress(value)'),
  'shared session runtime must own email masking');
assert.ok(session.includes("return visible + '•••@' + domain"),
  'email masking must hide the remainder of the local part');
assert.ok(session.includes('maskEmailAddress,'),
  'email masking helper must be exported through DanjionSession');

console.log('PASS #538 authenticated inquiry reply-email contract');
