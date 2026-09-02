import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, api, app] = await Promise.all([
  readFile(new URL('migrations/032_business_share_slug.sql', root), 'utf8'),
  readFile(new URL('src/business-share-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8')
]);

assert.match(migration, /add column if not exists share_slug text/i);
assert.match(migration, /shop-' \|\| encode\(gen_random_bytes\(12\), 'hex'\)/i,
  'share slug must be server-generated from cryptographic random bytes');
assert.match(migration, /alter column share_slug set not null/i);
assert.match(migration, /on business_complex_relations \(complex_id, share_slug\)/i,
  'share slug uniqueness must be scoped to a complex');
assert.match(migration, /prevent_business_share_slug_change/);
assert.match(migration, /before update of share_slug/i,
  'issued share slugs must be immutable');
assert.doesNotMatch(migration, /business.*name/i,
  'share slug generation must not depend on mutable business name');

assert.ok(api.includes('businesses\\/([0-9a-fA-F-]+)\\/share'),
  'UUID to share-slug resolver route must exist');
assert.ok(api.includes('businesses\\/share\\/([^/]+)'),
  'share-slug to UUID resolver route must exist');
assert.match(api, /request\.method !== 'GET'/,
  'resolver must be read-only');
assert.match(api, /c\.status in \('active','pilot'\)/,
  'inactive complexes must not resolve');
assert.match(api, /r\.verification_status = 'verified'/,
  'unverified relations must not resolve');
assert.match(api, /b\.status = 'approved'/,
  'unapproved businesses must not resolve');
assert.match(api, /businessId: String\(row\.business_id\)[\s\S]*shareSlug: String\(row\.share_slug\)/,
  'resolver payload must stay minimal');
assert.doesNotMatch(api, /owner_user_id|contact_value|building_code|unit_code|auth_user_id|evidence_object_key|\bemail\b/i,
  'public resolver must not project owner/contact/residence/provider PII');

assert.match(app, /handleBusinessShareRequest/);
assert.match(app, /const businessShareResponse = await handleBusinessShareRequest\(request, env, id\)/,
  'public share resolver must be mounted by the app router');

console.log('PASS stable public business share slug/resolver/privacy contract');
