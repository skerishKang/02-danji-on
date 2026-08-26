import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [server, mailer, vars] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-email-v1.ts', root), 'utf8'),
  readFile(new URL('.dev.vars.example', root), 'utf8')
]);

assert.match(server, /emailVerification:\s*\{/);
assert.match(server, /sendVerificationEmail:/);
assert.match(server, /sendOnSignUp:\s*true/);
assert.match(server, /sendOnSignIn:\s*requireEmailVerification/);
assert.match(server, /expiresIn:\s*3600/);
assert.match(server, /requireEmailVerification,/);
assert.match(server, /sendResetPassword:/);
assert.match(server, /resetPasswordTokenExpiresIn:\s*3600/);
assert.match(server, /revokeSessionsOnPasswordReset:\s*true/);
assert.match(server, /AUTH_REQUIRE_EMAIL_VERIFICATION/);
assert.match(server, /kind:\s*'verify-email'/);
assert.match(server, /kind:\s*'reset-password'/);

assert.match(mailer, /AuthEmailKind\s*=\s*'verify-email'\s*\|\s*'reset-password'/);
assert.match(mailer, /AUTH_EMAIL_RELAY_URL/);
assert.match(mailer, /AUTH_EMAIL_RELAY_TOKEN/);
assert.match(mailer, /AUTH_EMAIL_FROM/);
assert.match(mailer, /authorization:\s*`Bearer \$\{relayToken\}`/);
assert.match(mailer, /kind:\s*message\.kind/);
assert.doesNotMatch(mailer, /console\.(?:log|info|debug)/, 'auth mailer must not log email addresses or action URLs');
assert.doesNotMatch(mailer, /localStorage|sessionStorage/, 'server email tokens must never enter browser storage');

for (const name of [
  'AUTH_REQUIRE_EMAIL_VERIFICATION=true',
  'AUTH_EMAIL_RELAY_URL=',
  'AUTH_EMAIL_RELAY_TOKEN=',
  'AUTH_EMAIL_FROM='
]) {
  assert.ok(vars.includes(name), `missing ${name} configuration boundary`);
}

console.log('PASS Danjion email verification and password recovery contract');
