import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = readFileSync(path.join(root, 'src/resident-summary-v1.ts'), 'utf8');
const app = readFileSync(path.join(root, 'src/app.ts'), 'utf8');

function requireText(text, label) {
  if (!source.includes(text)) throw new Error(`Missing ${label}: ${text}`);
}

requireText("'/api/v1/me/summary'", 'canonical route');
requireText('requireVerifiedResident', 'Household-v2 authorization');
requireText("p.status in ('published', 'pending_review')", 'safe post count statuses');
requireText("c.status in ('published', 'pending_review')", 'safe comment count statuses');
requireText("p.status = 'published'", 'received reaction published-only boundary');
requireText('r.user_id <>', 'self-reaction exclusion');
requireText("b.status = 'approved'", 'approved business boundary');
requireText("rel.verification_status = 'verified'", 'verified business-complex boundary');
requireText('mine.last_read_at is null or m.created_at > mine.last_read_at', 'canonical unread semantics');
requireText("membershipRole: resident.membershipRole", 'safe household role projection');

// An exempt administrator principal is admitted by requireVerifiedResident
// without any household membership. The summary must never report that
// principal as a verified household member: the exemption is a
// resident-verification bypass, not a household. The exempt branch reports
// status 'exempt' with a null role, and the ordinary branch keeps the exact
// verified shape. Both branches must be present and mutually exclusive.
requireText('resident.residentVerificationExempt', 'the exemption flag must drive household reporting');
requireText("? { status: 'exempt', membershipRole: null }", 'exempt principals must not be reported as a verified household');
requireText(": { status: 'verified', membershipRole: resident.membershipRole }", 'ordinary residents keep the verified household shape');
if (!/residentVerificationExempt\s*\n?\s*\?\s*\{ status: 'exempt'/.test(source)) {
  throw new Error('the household projection must branch on the exemption flag, not on any other signal');
}
// 'exempt' must never be emitted as 'verified' anywhere for exempt principals.
const verifiedEmissions = (source.match(/status:\s*'verified'/g) || []).length;
if (verifiedEmissions !== 1) {
  throw new Error(`exactly one verified-household emission is allowed (found ${verifiedEmissions})`);
}

for (const forbidden of ['building_code', 'unit_code', 'complex_unit_id', 'householdId:', 'membershipId:', 'receivedBenefit', 'warmth']) {
  if (source.includes(forbidden)) throw new Error(`Resident summary must not expose or define ${forbidden}`);
}

if (!app.includes('handleResidentSummaryRequest')) throw new Error('Resident summary is not mounted in app.ts');
console.log('PASS resident summary contract: verified-resident aggregate, domain-safe counts, no residence IDs/warmth/benefit-policy leakage');
