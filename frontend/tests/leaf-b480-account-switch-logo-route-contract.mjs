import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #480: service-page brand routing and account switching must stay global.
// Run: node frontend/tests/leaf-b480-account-switch-logo-route-contract.mjs

const src = await readFile(new URL('../assets/consistency.js', import.meta.url), 'utf8');

assert.ok(src.includes("number!==29 && (el.classList.contains('brand') || el.classList.contains('wordmark') || el.matches('[data-brand-home]'))"),
  'service-page brand handler must exclude the public intro');
assert.ok(src.includes("location.href='04_데일리홈.html'"),
  'service-page brand must route directly to the actual home');
assert.ok(src.includes("event.stopImmediatePropagation()"),
  'service-page brand handler must win over legacy page-local routes');

assert.ok(src.includes("fetch('/api/auth/get-session'"),
  'service account strip must resolve the same-origin Better Auth session');
assert.ok(src.includes("현재 계정 · "),
  'service account strip must visibly identify the current login email');
assert.ok(src.includes("fetch('/api/auth/sign-out'"),
  'global logout must call same-origin Better Auth sign-out');
assert.ok(src.includes("location.href='index.html?intro=1'"),
  'logout must return to explicit intro so authenticated redirect cannot bounce to home');
assert.ok(src.includes("clearLocalAuthMarkers"),
  'logout must clear local prototype/session markers');
assert.ok(!src.includes("muphobia2@gmail.com") && !src.includes("skerish@naver.com"),
  'runtime identity UI must not hardcode operator/admin emails');

console.log('leaf-b480-account-switch-logo-route-contract: PASS');
