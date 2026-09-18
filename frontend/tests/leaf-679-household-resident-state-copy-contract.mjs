import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const [page, bridge, myInfo] = await Promise.all([
  read('../26_우리집연결.html'),
  read('../assets/household-claim-bridge.js'),
  read('../19_내정보_메인.html')
]);

assert.match(bridge, /async getSnapshot\(\)/,
  'household status must be read from the canonical server snapshot');
assert.match(page, /const \[snapshot,profile\]=await Promise\.all\(\[household\.getSnapshot\(\),resident\.profile\(\)\]\)/,
  'page 26 must reconcile household and self-profile state from the server');
assert.match(page, /reviewRequired:me\.status==='pending'&&!me\.residentVerified/,
  'pending household association must remain distinct from verified resident access');
assert.match(page, /운영팀 확인 대기/,
  'pending third-or-later household account must have explicit review copy');
assert.match(page, /우리집 연결 완료/,
  'auto-connected household account must have a separate completion state');
assert.doesNotMatch(page, /resident-verification-code-bridge|id="residentCode"/,
  'association-state UI must not depend on the superseded household-code flow');
assert.doesNotMatch(page, /localStorage|sessionStorage/,
  'household authority must not be persisted in browser storage');

assert.ok(myInfo.includes("'우리집 연결됨 · 운영팀 확인 대기'"),
  'My Info must keep household association and operations review distinct');
assert.ok(myInfo.includes("'주민인증 완료'"),
  'My Info must still render verified server membership distinctly');

console.log('PASS household association/review state copy contract');
