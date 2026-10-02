import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const script = fs.readFileSync(path.join(root, 'scripts', 'production-resident-ui-readonly.mjs'), 'utf8');

assert.ok(script.includes("const EXPECTED_HOST = 'danjion.pages.dev';"));
assert.ok(script.includes('DANJION_PRODUCTION_TEST_RESIDENT_EMAIL'));
assert.ok(script.includes('DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD'));
assert.ok(!script.includes('DANJION_PRODUCTION_OPERATOR_EMAIL'));
assert.ok(!script.includes('DANJION_PRODUCTION_SUPER_EMAIL'));
assert.ok(!script.includes('DATABASE_URL'));
assert.ok(!script.includes('DANJION_PRODUCTION_DB_URL'));

for (const route of [
  '/04_데일리홈.html',
  '/08_아파트소식_목록.html',
  '/10_주민소식_목록.html',
  '/01_이웃가게_발견.html',
  '/03_주민혜택_쿠폰.html',
  '/05_우리단지_첫화면.html',
  '/12_이웃대화_첫화면.html',
  '/20_메시지함_목록.html',
  '/19_내정보_메인.html',
  '/24_설정.html',
  '/26_우리세대.html',
  '/27_알림함.html',
  '/28_나의활동.html',
  '/admin/',
]) {
  assert.ok(script.includes(route), `missing resident audit route: ${route}`);
}

assert.ok(script.includes("page.on('request'"), 'network mutation guard must be installed');
assert.ok(script.includes("url.pathname === '/api/auth/sign-in/email'"));
assert.ok(script.includes("url.pathname === '/api/auth/sign-out'"));
assert.ok(script.includes("finding('UNEXPECTED_MUTATION', 'P0'"));
assert.ok(script.includes("console.log('PRODUCT_DATA_MUTATION=0')"));
assert.ok(script.includes("console.log('ACCOUNT_PROVISIONING=0')"));
assert.ok(script.includes("console.log('GRANT_MUTATION=0')"));
assert.ok(script.includes("console.log('SECRET_OUTPUT=0')"));

assert.ok(!/context\.request\.(?:put|patch|delete)\s*\(/.test(script), 'product mutation request helpers are forbidden');
const postCalls = [...script.matchAll(/context\.request\.post\(([^\n]+)/g)].map((m) => m[1]);
assert.equal(postCalls.length, 1, 'only the bounded sign-out fallback may use context.request.post');
assert.ok(postCalls[0].includes('/api/auth/sign-out'), 'the only direct POST must be auth sign-out');

assert.ok(script.includes("input[type=\"email\"]"));
assert.ok(script.includes("input[type=\"password\"]"));
assert.ok(!script.includes('screenshot('), 'resident audit must not persist screenshots containing resident UI data');

console.log('PRODUCTION_RESIDENT_UI_READONLY_CONTRACT=PASS');
