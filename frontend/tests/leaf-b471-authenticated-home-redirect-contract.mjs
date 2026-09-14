import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #471: public landing and authenticated service home must not compete.
// Authenticated canonical sessions visiting index.html go to 04_데일리홈.html;
// guests remain on the public landing.
// Run: node frontend/tests/leaf-b471-authenticated-home-redirect-contract.mjs

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.ok(index.includes("serverSessionCheck().then((real)=>{"),
  'landing must still resolve the real server session before routing');
assert.ok(index.includes("if(real){location.replace('04_데일리홈.html');return}"),
  'authenticated landing visits must replace history with the service home');
assert.ok(index.includes("memberMode=real;sessionResolved=true;syncMemberState();"),
  'session state must be resolved before the authenticated redirect');
assert.ok(index.includes("else{sessionStorage.removeItem('danjionMember');"),
  'unauthenticated resolution must still clear stale member state');
assert.ok(index.includes("refreshAdminEntry()"),
  'guest/public landing authority refresh path must remain wired');
assert.ok(index.includes("function finishDanjionLogout()"),
  'logout behavior must remain present');
assert.ok(index.includes("location.href='04_데일리홈.html'"),
  'explicit member entry actions must continue to target the service home');

console.log('leaf-b471-authenticated-home-redirect-contract: PASS');
