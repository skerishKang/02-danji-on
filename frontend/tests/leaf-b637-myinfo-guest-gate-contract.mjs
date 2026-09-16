import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page=await readFile(new URL('../19_내정보_메인.html',import.meta.url),'utf8');

assert.match(
  page,
  /<section class="myinfo-access-gate" id="myinfoAccessGate"[^>]*>[\s\S]*href="index\.html\?auth=login"[^>]*hidden>[\s\S]*<main id="myinfoPrivateContent" hidden>/,
  'My Info must render a generic access gate before the private dashboard and route login to the canonical landing auth intent'
);

assert.match(
  page,
  /function sessionIdentity\(\)\{[\s\S]*S\.fetchSession\(fetch\)[\s\S]*if\(!user\)\{[\s\S]*state:'guest'[\s\S]*fetchLinkedAccounts/,
  'My Info must resolve the native session before fetching linked-account details'
);

const sessionBlock=page.match(/function sessionIdentity\(\)\{([\s\S]*?)\n  function bindEmailResend/);
assert.ok(sessionBlock,'sessionIdentity block must remain detectable');
assert.doesNotMatch(
  sessionBlock[1],
  /Promise\.all\(\[sp,ap\]\)/,
  'guest detection must not issue session and linked-account requests in parallel'
);

const bootstrap=page.match(/sessionIdentity\(\)\.then\(function\(identity\)\{([\s\S]*?)\n  \}\);/);
assert.ok(bootstrap,'My Info authenticated bootstrap must remain detectable');
assert.match(
  bootstrap[1],
  /if\(!identity\|\|!identity\.user\)\{[\s\S]*showGuestGate[\s\S]*return;[\s\S]*showPrivateContent\(\);[\s\S]*resolveResidentExemption\(\)/,
  'guest must stop before any authority/resident hydration; authenticated users may continue'
);
assert.match(
  bootstrap[1],
  /resolveResidentExemption\(\)[\s\S]*loadResidentData\(\);[\s\S]*loadResidentState\(\);/,
  'resident/profile/household hydration must remain inside the authenticated branch'
);

assert.match(
  page,
  /function showGuestGate\(state\)\{[\s\S]*privateContent\.hidden=true[\s\S]*guestLogin\.hidden=false/,
  'guest verdict must keep personal content hidden and expose only the bounded login gate'
);
assert.match(
  page,
  /function showPrivateContent\(\)\{[\s\S]*accessGate\.hidden=true[\s\S]*privateContent\.hidden=false/,
  'authenticated verdict must reveal the private dashboard'
);

const gate=page.match(/<section class="myinfo-access-gate" id="myinfoAccessGate"[\s\S]*?<\/section>/);
assert.ok(gate,'guest access gate markup must remain detectable');
assert.doesNotMatch(
  gate[0],
  /\b(?:101동|102동|호|메시지\s*\d|주민인증 완료|이메일 주소|@)\b/,
  'guest gate must not contain resident/account PII or household state'
);

console.log('leaf-b637-myinfo-guest-gate-contract: PASS');
