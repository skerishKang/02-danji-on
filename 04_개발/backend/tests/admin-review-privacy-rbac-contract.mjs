import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const audit = readFileSync(resolve(root, 'src', 'admin-audit-v1.ts'), 'utf8');
const review = readFileSync(resolve(root, 'src', 'admin-review-context-v1.ts'), 'utf8');
const verification = readFileSync(resolve(root, 'src', 'admin-verification-v1.ts'), 'utf8');

for (const source of [audit, review]) {
  assert.match(source, /requireOperationalAuthority/);
  assert.match(source, /business\.review/);
  assert.match(source, /council\.business\.review/);
  assert.doesNotMatch(source, /(?:from|join)\s+complex_memberships\s+m[\s\S]*role\s+in\s*\('manager','admin'\)/i);
  assert.doesNotMatch(source, /requireManager|managerComplex/i);
}

assert.match(audit, /e\.complex_id = \$\{operator\.complexId\}::uuid/);

assert.match(review, /verification_evidence_count/i);
assert.match(review, /residentVerificationStatus/);
assert.match(review, /verificationEvidenceCount/);
assert.doesNotMatch(review, /evidence_object_key/i);
assert.doesNotMatch(review, /auth_user_id/i);
assert.doesNotMatch(review, /\bbuilding\b|\bunit\b/i);
assert.doesNotMatch(review, /phone|email|provider/i);

assert.match(verification, /RESIDENT_VERIFICATION_POLICY_HOLD/);
assert.match(verification, /requireActor/);
assert.doesNotMatch(verification, /select[\s\S]*resident_verifications/i);
assert.doesNotMatch(verification, /update[\s\S]*resident_verifications/i);
assert.doesNotMatch(verification, /select[\s\S]*complex_memberships/i);
assert.doesNotMatch(verification, /role\s+in\s*\('manager','admin'\)/i);
assert.doesNotMatch(verification, /evidence_object_key|auth_user_id|\bbuilding\b|\bunit\b/i);

console.log('Admin review/privacy RBAC contract PASS: PADIEM+council review, resident verification fail-closed');
