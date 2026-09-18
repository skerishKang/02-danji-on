import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [api, crypto, verify, app, policy] = await Promise.all([
  readFile(new URL('src/admin-household-codes-v1.ts', root), 'utf8'),
  readFile(new URL('src/household-code-crypto.ts', root), 'utf8'),
  readFile(new URL('src/household-code-verification-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/admin-scope-policy-v1.ts', root), 'utf8')
]);

assert.match(api, /resident\.verification\.manage/);
assert.match(api, /council\.resident\.verification\.manage/);
assert.match(api, /requireOperationalAuthority/);
assert.match(api, /household_verification_codes/);
assert.match(api, /code_verifier/);
assert.match(api, /generateHouseholdCode\(8\)/);
assert.match(api, /householdCodeVerifier\(code, pepper\)/);
assert.match(api, /status = 'revoked', revoked_at = now\(\)/);
assert.match(api, /coalesce\(\([\s\S]*max\(existing\.generation\) \+ 1/s);
assert.match(api, /oneTimeDisplay: true/);
assert.match(api, /codeDisplay: code\.slice\(0, 4\) \+ '-' \+ code\.slice\(4\)/);
assert.doesNotMatch(api, /select[\s\S]{0,300}code_verifier[\s\S]{0,300}return ok/i,
  'admin list must not return stored verifiers');
assert.doesNotMatch(api, /console\.log|console\.error/,
  'admin household code operations must not log plaintext/verifier/unit material');
assert.match(api, /use_count/);
assert.match(api, /verified_member_count/);
assert.match(api, /alreadyRevoked/);

assert.match(crypto, /ABCDEFGHJKLMNPQRSTUVWXYZ23456789/,
  'generated SMS code alphabet should omit ambiguous 0/O/1/I characters');
assert.match(crypto, /crypto\.getRandomValues/);
assert.match(crypto, /HMAC/);
assert.match(crypto, /SHA-256/);
assert.match(verify, /householdCodeVerifier/);
assert.match(verify, /normalizeHouseholdCode/);

assert.ok(policy.includes("'resident.verification.manage'"),
  'operator preset must include bounded resident code management scope');
assert.match(app, /handleAdminHouseholdCodeRequest/);
assert.ok(
  app.indexOf('handleAdminHouseholdCodeRequest(request, env, id)') <
  app.indexOf('handleAdminRequest(request, env, id)'),
  'household code admin handler must intercept before terminal admin fallback'
);

console.log('PASS #735 admin household-code operations source contract');
