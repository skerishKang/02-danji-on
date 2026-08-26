import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [server, schema, migration, app, authResolver] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-better-schema.ts', root), 'utf8'),
  readFile(new URL('migrations/014_danjion_better_auth.sql', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/auth-v1.ts', root), 'utf8')
]);

for (const provider of ['google', 'kakao', 'naver']) {
  assert.match(server, new RegExp(`${provider}:`), `missing ${provider} social provider boundary`);
}

assert.match(server, /emailAndPassword:\s*\{[\s\S]*enabled:\s*true/);
assert.match(server, /username\(\{/);
assert.match(server, /displayUsername:\s*false/);
assert.match(server, /usernameNormalization:\s*normalizeKoreanPhone/);
assert.match(server, /usernameValidator:/);
assert.match(server, /SMS|sms/, 'contract should explicitly record the no-SMS boundary in docs/tests');
assert.doesNotMatch(server, /phoneNumber\(/, 'phone plugin would couple this v1 path to phone verification/OTP semantics');

assert.match(server, /jwt\(\{/);
assert.match(authResolver, /\/api\/auth\/jwks/);
assert.match(app, /handleBetterAuthRequest/);
assert.ok(app.indexOf('handleBetterAuthRequest') < app.indexOf('validateRequestPayload(request'), 'auth handler must be mounted before app JSON payload policy');

assert.match(schema, /pgSchema\('danjion_auth'\)/);
assert.match(migration, /create schema if not exists danjion_auth/i);
assert.doesNotMatch(migration, /create\s+(?:table|schema).*neon_auth/i, 'migration must never own the managed neon_auth schema');
assert.match(migration, /issuer text not null/i);
assert.match(migration, /unique index[\s\S]*issuer, account_id/i);
assert.match(migration, /username text unique/i);
assert.match(migration, /Never use this schema as resident verification authority/i);

console.log('PASS Danjion Better Auth five-method boundary contract');
