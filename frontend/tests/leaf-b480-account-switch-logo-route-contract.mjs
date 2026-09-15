import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Issue #480, superseded by #537/#544 for brand destination:
// account switching stays global, while service-page brand opens explicit Intro.
const consistency = await readFile(new URL('../assets/consistency.js', import.meta.url), 'utf8');
const session = await readFile(new URL('../assets/danjion-session.js', import.meta.url), 'utf8');

assert.ok(consistency.includes("number!==29 && (el.classList.contains('brand') || el.classList.contains('wordmark') || el.matches('[data-brand-home]'))"),
  'service-page brand handler must exclude the public intro itself');
assert.ok(consistency.includes("location.href='index.html?intro=1'"),
  'service-page brand must route to the explicit Intro');
const sharedBrandBlock = (consistency.match(/if\(number!==29 && \(el\.classList\.contains\('brand'\)[\s\S]*?\n    \}/)||[])[0]||'';
assert.equal(sharedBrandBlock.includes("04_데일리홈.html"), false,
  'shared brand handler must not override logo clicks back to Home');
assert.ok(consistency.includes("event.stopImmediatePropagation()"),
  'service-page brand handler must win over stale page-local routes');
assert.ok(consistency.includes("script.src='assets/danjion-session.js'"),
  'service pages without the session runtime must load the canonical session asset');
assert.ok(!consistency.includes('/api/auth'),
  'general consistency runtime must never call Better Auth endpoints');

assert.ok(session.includes("'/api/auth/get-session'"),
  'session runtime must resolve the same-origin Better Auth session');
assert.ok(session.includes("emailNode.textContent = authKind.hasSocial"),
  'integrated account menu must branch account identity by auth kind');
assert.ok(session.includes("authKind.socialLabel + ' 로그인 계정'"),
  'social sessions must identify the provider rather than expose provider-returned contact email');
assert.ok(session.includes("emailNode.title = authKind.hasSocial ? '' : email"),
  'social provider contact email must not leak through the title attribute');
assert.ok(session.includes("className = 'danjion-account-menu'"),
  'account identity must live in the integrated header menu rather than a floating strip');
assert.ok(session.includes("'/api/auth/sign-out'"),
  'global logout must call same-origin Better Auth sign-out');
assert.ok(session.includes("location.href = 'index.html?intro=1'"),
  'logout must return to explicit intro');
assert.ok(session.includes("clearLocalAuthMarkers"),
  'logout must clear local prototype/session markers');
assert.ok(!session.includes("muphobia2@gmail.com") && !session.includes("skerish@naver.com"),
  'runtime identity UI must not hardcode operator/admin emails');

console.log('leaf-b480-account-switch-logo-route-contract: PASS #537/#544 authority');
