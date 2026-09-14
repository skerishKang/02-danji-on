import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #473: actual service-home markup must own the visible nav contract.
// Run: node frontend/tests/leaf-b473-home-nav-source-contract.mjs

const home = await readFile(new URL('../04_데일리홈.html', import.meta.url), 'utf8');

assert.ok(home.includes('<button class="brand" data-route="04_데일리홈.html"'),
  'home logo must route to the service home');
assert.ok(home.includes('<button class="active" data-route="04_데일리홈.html" type="button">홈</button>'),
  'Home must route to the service home');
assert.ok(home.includes('<button data-route="index.html?intro=1" type="button">인트로</button>'),
  'desktop nav must expose an explicit Intro entry');
assert.ok(home.includes('body[data-danjion-page="4"] .brand small{display:none!important}'),
  'home-specific compact logo rule may remain');
assert.ok(!home.includes('body[data-danjion-page="4"] .brand small,body[data-danjion-page="4"] .nav{display:none!important}'),
  'home navigation must not be hidden');
assert.ok(home.includes("if(cls.contains('brand')){ev.preventDefault();ev.stopImmediatePropagation();go(FILES.home);return;}"),
  'direct router must align logo with Home');
assert.ok(!home.includes("if(cls.contains('brand')){ev.preventDefault();ev.stopImmediatePropagation();go(B?'index2.html':'index.html');return;}"),
  'direct router must not send the logo to the public landing');

console.log('leaf-b473-home-nav-source-contract: PASS');
