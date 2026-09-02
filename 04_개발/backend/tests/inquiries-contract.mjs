import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app] = await Promise.all([
  readFile(new URL('migrations/030_inquiries.sql', root), 'utf8'),
  readFile(new URL('src/inquiries-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /create table if not exists inquiries/i);
assert.match(migration, /received','in_progress','answered','closed/i);
assert.match(migration, /status not in \('answered','closed'\).*response_text is not null.*answered_at is not null/is,
  'answered/closed inquiry must have response and answered timestamp');
assert.match(migration, /status <> 'closed' or closed_at is not null/i);
assert.doesNotMatch(migration, /attachment|object_key|file_url/i,
  'photo attachment must remain outside decision-free inquiry core');

assert.match(api, /requireVerifiedResident\(/, 'resident inquiry surfaces require verified resident');
assert.match(api, /requireOperationalAuthority\(/, 'operator inquiry surfaces reuse operational RBAC');
assert.match(api, /'inquiry\.respond'.*'council\.inquiry\.respond'/s);
assert.match(api, /\/api\/v1\/me\/inquiries/);
assert.match(api, /adminQueue = path\.match/);
assert.match(api, /adminItem = path\.match/);
assert.match(api, /sql\.transaction\(/, 'answer and notification must be transactional');
assert.match(api, /'inquiry_answer'/);
assert.match(api, /'inquiry-answer:' \|\| i\.id::text/);
assert.match(api, /on conflict \(user_id, source_event_key\).*do nothing/s,
  'answer notification must be idempotent');
assert.doesNotMatch(api, /building_code|unit_code|resident_code|auth_user_id|evidence_object_key|\bemail\b/i,
  'inquiry API must not project residence/provider PII');
assert.match(app, /handleInquiryRequest/);

console.log('PASS resident inquiry lifecycle/operator response/notification privacy contract');
