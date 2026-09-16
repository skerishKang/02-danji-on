import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// #537 supersedes the old #471 redirect authority.
// The site root is the stable Intro entry even for authenticated users.
// Successful authentication still continues into the service Home.

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const consistency = await readFile(new URL('../assets/consistency.js', import.meta.url), 'utf8');

assert.ok(index.includes("async function reconcileLandingSession()") &&
          index.includes("const real=await serverSessionCheck();"),
  'landing must still resolve the real server session through the centralized reconciliation path');
assert.ok(index.includes("memberMode=real;sessionResolved=true;syncMemberState();"),
  'session state must still resolve on Intro');
assert.equal(index.includes("const explicitIntro=new URLSearchParams(location.search).get('intro')==='1'"), false,
  'Intro visibility must not depend on a query-only redirect escape hatch');
assert.equal(index.includes("if(real&&!explicitIntro){location.replace('04_데일리홈.html');return}"), false,
  'authenticated root/Intro visits must not be bounced to Home');
assert.ok(index.includes("location.replace('04_데일리홈.html')"),
  'successful email login must still continue into the service Home');
assert.match(index, /else\{\s*sessionStorage\.removeItem\('danjionMember'\);[\s\S]*sessionStorage\.removeItem\('danjionSignedUp'\);[\s\S]*sessionStorage\.removeItem\('danjionAuthPending'\);\s*\}/,
  'unauthenticated resolution must still clear stale member state');
assert.ok(index.includes("function finishDanjionLogout()"),
  'logout behavior must remain present');

assert.ok(consistency.includes("setRoute(intro,'index.html?intro=1')"),
  'desktop navigation must expose the explicit Intro destination');
assert.ok(consistency.includes("forEach(brand=>setRoute(brand,'index.html?intro=1'))"),
  'service logos and wordmarks must resolve to Intro');
assert.ok(consistency.includes("if(label==='인트로')setRoute(control,'index.html?intro=1')"),
  'Intro controls must normalize to the explicit Intro route');
assert.equal(consistency.includes("forEach(brand=>setRoute(brand,route(4)))"), false,
  'common routing must not force service logos to Home');

console.log('leaf-b471-authenticated-home-redirect-contract: PASS #537 stable Intro authority');
