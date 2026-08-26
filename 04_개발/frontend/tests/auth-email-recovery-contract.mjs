import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [client, app, html, vite] = await Promise.all([
  readFile(new URL('src/auth-client.ts', root), 'utf8'),
  readFile(new URL('src/AuthRecoveryApp.tsx', root), 'utf8'),
  readFile(new URL('auth-recovery.html', root), 'utf8'),
  readFile(new URL('vite.config.ts', root), 'utf8')
]);

assert.match(client, /sendVerificationEmail/);
assert.match(client, /requestPasswordReset/);
assert.match(client, /resetPassword/);
assert.match(client, /redirectTo:\s*passwordResetCallbackURL\(\)/);
assert.match(client, /callbackURL:\s*emailVerificationCallbackURL\(\)/);
assert.match(client, /assertAuthSuccess/);
assert.doesNotMatch(client, /localStorage|sessionStorage/, 'recovery tokens must not be persisted in browser storage');

assert.match(app, /비밀번호 찾기/);
assert.match(app, /인증메일 다시 받기/);
assert.match(app, /보안을 위해 계정 존재 여부는 화면에서 구분해 알려드리지 않습니다/);
assert.match(app, /initial\.token/);
assert.match(app, /password !== confirmPassword/);
assert.match(app, /LIVE_AUTH/);
assert.match(app, /ACCOUNT RECOVERY/);

assert.match(html, /noindex,nofollow/);
assert.match(html, /auth-recovery-main\.tsx/);
assert.match(vite, /authRecovery:\s*resolve\(__dirname, 'auth-recovery\.html'\)/);

console.log('PASS Danjion browser email verification and password recovery contract');
