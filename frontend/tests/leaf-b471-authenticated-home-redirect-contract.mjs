import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #471: public landing and authenticated service home must not compete.
// Authenticated canonical sessions go to 04_데일리홈.html by default.
// Authenticated users may explicitly open the intro via index.html?intro=1.
// Run: node frontend/tests/leaf-b471-authenticated-home-redirect-contract.mjs

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const consistency = await readFile(new URL('../assets/consistency.js', import.meta.url), 'utf8');

assert.ok(index.includes("serverSessionCheck().then((real)=>{"),
  'landing must resolve the real server session before routing');
assert.ok(index.includes("const explicitIntro=new URLSearchParams(location.search).get('intro')==='1'"),
  'landing must recognize an explicit authenticated intro request');
assert.ok(index.includes("if(real&&!explicitIntro){location.replace('04_데일리홈.html');return}"),
  'ordinary authenticated landing visits must replace history with the service home');
assert.ok(index.includes("memberMode=real;sessionResolved=true;syncMemberState();"),
  'session state must be resolved before redirect');
assert.ok(index.includes("else{sessionStorage.removeItem('danjionMember');"),
  'unauthenticated resolution must still clear stale member state');
assert.ok(index.includes("function finishDanjionLogout()"),
  'logout behavior must remain present');

assert.ok(consistency.includes("setRoute(intro,'index.html?intro=1')"),
  'member desktop navigation must expose an explicit Intro destination');
assert.ok(consistency.includes("if(number!==29)document.querySelectorAll('.brand,.wordmark,[data-brand-home]').forEach(brand=>setRoute(brand,route(4)))"),
  'member-page logo and wordmark must resolve to the service home');
assert.ok(consistency.includes("if(label==='인트로')setRoute(control,'index.html?intro=1')"),
  'Intro controls must normalize to the explicit intro route');
assert.ok(!consistency.includes("forEach(brand=>setRoute(brand,route(29)))"),
  'common routing must no longer force member logos to the public landing');

console.log('leaf-b471-authenticated-home-redirect-contract: PASS');
