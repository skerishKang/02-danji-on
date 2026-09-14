import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');
const my = await readFile(new URL('../19_내정보_메인.html', import.meta.url), 'utf8');

assert.ok(!session.includes("className = 'danjion-account-session'"),
  'floating account box must be removed');
assert.ok(session.includes("className = 'danjion-account-trigger'"),
  'account UI must use an integrated header trigger');
assert.ok(session.includes("document.querySelector('.identity') || document.querySelector('[data-account-host]')"),
  'account control must reuse the existing header identity slot');
assert.ok(session.includes("my.href = '19_내정보_메인.html'"));
assert.ok(session.includes("settings.href = '24_설정.html'"));
assert.ok(session.includes("'/api/auth/sign-out'"));
assert.ok(session.includes("location.href = 'index.html?intro=1'"));

for (const label of ['홈','인트로','이웃가게','우리단지','내정보']) {
  assert.ok(my.includes(`>${label}<`), `My Info header must contain ${label}`);
}
assert.ok(my.includes('data-route="index.html?intro=1"'),
  'Intro must use the explicit intro route');
assert.ok(my.includes('data-account-host'),
  'My Info must expose the header account host');

console.log('leaf-b483-unified-header-account-menu-contract: PASS');
