import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const wrangler = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
const adapter = await readFile(new URL('src/padiem-contact-verification-v1.ts', root), 'utf8');
const signup = await readFile(new URL('src/signup-contact-verification-v1.ts', root), 'utf8');

const production = wrangler.env?.production;
assert.ok(production, 'production Worker environment must exist');
assert.equal(production.name, 'padiem-danjion-api-production');
assert.deepEqual(production.services, [
  {
    binding: 'PADIEM_CONTACT_VERIFICATION',
    service: 'padiem-contact-verification'
  }
], 'production must bind only to the canonical internal Padiem verification Worker');

assert.equal(wrangler.env?.preview?.services, undefined, 'preview must not silently inherit the production verification binding');
assert.match(adapter, /PADIEM_CONTACT_VERIFICATION\?: PadiemContactVerificationRpc/, 'adapter env must expose the canonical binding');
assert.match(adapter, /CONTACT_VERIFICATION_NOT_CONFIGURED/, 'missing binding must fail closed');
assert.doesNotMatch(adapter, /generate|randomInt|HMAC|SHA-256/i, 'DanjiOn adapter must not fork OTP generation or hashing');
assert.match(signup, /PADIEM_CONTACT_DELIVERY/, 'delivery must remain a separate explicit trusted binding');

console.log('Signup contact production binding contract: PASS');
