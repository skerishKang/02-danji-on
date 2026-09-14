import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #480: service-page brand routing and account switching must stay global.
// Run: node frontend/tests/leaf-b480-account-switch-logo-route-contract.mjs

const consistency = await readFile(new URL('../assets/consistency.js', import.meta.url), 'utf8');
const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');

assert.ok(consistency.includes("number!==29 && (el.classList.contains('brand') || el.classList.contains('wordmark') || el.matches('[data-brand-home]'))"),
  'service-page brand handler must exclude the public intro');
assert.ok(consistency.includes("location.href='04_데일리홈.html'"),
  'service-page brand must route directly to the actual home');
assert.ok(consistency.includes("event.stopImmediatePropagation()"),
  'service-page brand handler must win over legacy page-local routes');
assert.ok(consistency.includes("script.src='assets/danjion-session.js'"),
  'service pages without the session runtime must load the canonical session asset');
assert.ok(!consistency.includes('/api/auth'),
  'general consistency runtime must never call Better Auth endpoints');

assert.ok(session.includes("'/api/auth/get-session'"),
  'session runtime must resolve the same-origin Better Auth session');
assert.ok(session.includes("emailNode.textContent = email"),
  'integrated account menu must visibly identify the current login email');
assert.ok(session.includes("className = 'danjion-account-menu'"),
  'account identity must live in the integrated header menu rather than a floating strip');
assert.ok(session.includes("'/api/auth/sign-out'"),
  'global logout must call same-origin Better Auth sign-out');
assert.ok(session.includes("location.href = 'index.html?intro=1'"),
  'logout must return to explicit intro so authenticated redirect cannot bounce to home');
assert.ok(session.includes("clearLocalAuthMarkers"),
  'logout must clear local prototype/session markers');
assert.ok(!session.includes("muphobia2@gmail.com") && !session.includes("skerish@naver.com"),
  'runtime identity UI must not hardcode operator/admin emails');

console.log('leaf-b480-account-switch-logo-route-contract: PASS');
