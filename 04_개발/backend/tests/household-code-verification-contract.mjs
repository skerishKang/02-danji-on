import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app, rate, inquiries, ledger] = await Promise.all([
  readFile(new URL('migrations/050_household_verification_codes.sql', root), 'utf8'),
  readFile(new URL('src/household-code-verification-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/product-rate-limit-v1.ts', root), 'utf8'),
  readFile(new URL('src/inquiries-v1.ts', root), 'utf8'),
  readFile(new URL('migration-safety-ledger.json', root), 'utf8')
]);

assert.match(migration, /create table if not exists household_verification_codes/i);
assert.match(migration, /code_verifier text not null unique/i);
assert.doesNotMatch(migration, /\bplaintext\b.*(?:column|text)|resident_code text|verification_code text/i,
  'schema must never persist a plaintext household code');
assert.match(migration, /unique index if not exists uq_household_verification_code_active_household/i);
assert.match(migration, /use_count integer not null default 0/i,
  'household credential must be reusable by legitimate family accounts');
assert.match(migration, /verify_success','verify_failed','rotate','revoke/i);

assert.match(api, /HOUSEHOLD_CODE_PEPPER/);
assert.match(api, /HMAC.*SHA-256/s);
assert.match(api, /replace\(\/\[\\s-\]\+\/g, ''\)/);
assert.match(api, /requireActor/);
assert.match(api, /membership_role, status, verified_at[\s\S]*'member', 'verified', now\(\)/);
assert.match(api, /set use_count = vc\.use_count \+ 1, last_used_at = now\(\)/);
assert.doesNotMatch(api, /status = 'redeemed'/,
  'successful verification must not consume the household credential');
assert.match(api, /RESIDENT_CODE_INVALID.*invalid or unavailable/s,
  'invalid/revoked/nonexistent codes must share one generic response');
assert.doesNotMatch(api, /console\.log|console\.error/,
  'verification route must not log code, unit or contact material');

assert.match(app, /handleHouseholdCodeVerificationRequest/);
assert.ok(app.indexOf('handleHouseholdCodeVerificationRequest(request, env, id)') <
  app.indexOf('handleHouseholdUnitMasterRequest(request, env, id)'),
  'code-first verification must be mounted before legacy unit-selection household flow');

assert.match(rate, /resident_verification_code: \{ action: 'resident_verification_code', max: 10, windowSeconds: 60 \* 60 \}/);
assert.match(rate, /resident-verification\\\/code/);

assert.match(inquiries, /resident_verification_code_request/);
assert.match(inquiries, /if \(inquiryType === 'resident_verification_code_request'\)[\s\S]*requireActor/,
  'code request must work for an authenticated but unverified account');
assert.match(inquiries, /else \{[\s\S]*requireVerifiedResident/,
  'ordinary inquiry categories must retain verified-resident authorization');

const parsed = JSON.parse(ledger);
assert.deepEqual(parsed.migrations['050_household_verification_codes.sql'], {
  class: 'schema',
  marker: { kind: 'table', schema: 'public', name: 'household_verification_codes' }
});

console.log('PASS #735 household-code resident verification source contract');
