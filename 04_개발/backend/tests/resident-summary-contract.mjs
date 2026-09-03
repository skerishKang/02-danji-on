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

for (const forbidden of ['building_code', 'unit_code', 'complex_unit_id', 'householdId:', 'membershipId:', 'receivedBenefit', 'warmth']) {
  if (source.includes(forbidden)) throw new Error(`Resident summary must not expose or define ${forbidden}`);
}

if (!app.includes('handleResidentSummaryRequest')) throw new Error('Resident summary is not mounted in app.ts');
console.log('PASS resident summary contract: verified-resident aggregate, domain-safe counts, no residence IDs/warmth/benefit-policy leakage');
