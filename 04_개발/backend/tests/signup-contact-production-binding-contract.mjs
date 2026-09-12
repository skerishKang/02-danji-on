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

/* --- #423: a read-only readiness probe lets the signup UX fail closed honestly --- */
// The probe must expose the EXACT same three trusted-binding guard that startVerification
// enforces before it will issue a challenge, so the UX cannot claim "ready" when a real
// OTP send would only 503. It must return only the boolean, never an OTP, opaque ref, or secret.
assert.match(
  signup,
  /function verificationReady\(env: SignupContactVerificationEnv\): boolean \{[\s\S]*?return !\(!env\.PADIEM_CONTACT_VERIFICATION \|\| !env\.PADIEM_CONTACT_DELIVERY \|\| !env\.DANJION_CONTACT_REF_SECRET\);/,
  'readiness must gate on the same three trusted bindings as startVerification'
);
assert.match(
  signup,
  /if \(request\.method === 'GET' && path === '\/auth\/verification\/readiness'\) \{\s*return ok\(\{ ready: verificationReady\(env\) \}, requestId\);\s*\}/,
  'GET readiness route must expose only the boolean ready flag'
);
assert.ok(
  signup.indexOf('/auth/verification/readiness') < signup.indexOf("if (request.method !== 'POST') return null;"),
  'readiness must be served before the POST-only gate'
);
assert.match(signup, /VERIFICATION_NOT_CONFIGURED/, 'start must still fail closed when any binding is missing');

console.log('Signup contact production binding contract: PASS');
