import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const flat = s => s.toLowerCase().replace(/\s+/g, ' ');

/* 1. migration 047 is additive and bounded: one named check rebuild, no data ops. */
const migration = flat(read('migrations/047_community_greeting_kind.sql').replace(/^\s*--.*$/gm, ''));
assert.match(migration, /alter table community_posts drop constraint if exists community_posts_kind_check;/);
assert.match(migration, /alter table community_posts drop constraint if exists community_posts_kind_check_c2;/);
assert.match(migration, /add constraint community_posts_kind_check_c2 check \(kind in \('question','together','resident_story','life_report','greeting'\)\)/);
for (const forbidden of [/drop table/, /truncate/, /delete from/, /update\s/, /alter column/, /create index/, /drop index/, /do\s+\$\$/]) {
  assert.equal(forbidden.test(migration), false, `047 must stay bounded, found ${forbidden}`);
}

/* 2. historical migrations stay untouched: 013 keeps the original anonymous four-kind check. */
const base = flat(read('migrations/013_community_core.sql'));
assert.match(base, /kind text not null check \(kind in \('question','together','resident_story','life_report'\)\)/);

/* 3. inventory: 047 exists and 048 remains the historical main authority. */
const migrations = readdirSync(resolve(root, 'migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes('047_community_greeting_kind.sql'), '047 must ship for this leaf');
assert.ok(migrations.includes('048_owner_application_relation_resolution.sql'), '048 must not be renumbered or renamed');

/* 4. safety ledger registration and full inventory sync (gate fails closed otherwise). */
const ledger = JSON.parse(read('migration-safety-ledger.json'));
const entry = ledger.migrations['047_community_greeting_kind.sql'];
assert.ok(entry, '047 must be registered in the migration safety ledger');
assert.equal(entry.class, 'schema');
assert.deepEqual(entry.marker, { kind: 'constraint', table: 'community_posts', name: 'community_posts_kind_check_c2' });
for (const file of migrations) assert.ok(ledger.migrations[file], `ledger missing classification: ${file}`);
for (const file of Object.keys(ledger.migrations)) assert.ok(migrations.includes(file), `ledger references missing file: ${file}`);

/* 5. the production gate classifier accepts 047 and reads its marker. */
const { classifyMigration, markerToSql } = await import('../scripts/production-migration-gate.mjs');
assert.equal(classifyMigration(ledger, '047_community_greeting_kind.sql').class, 'schema');
assert.match(markerToSql(entry.marker), /community_posts_kind_check_c2/);

/* 6. server-authoritative canonical kind in the resident API, with no coercion. */
const api = read('src/community-resident-v1.ts');
assert.match(api, /type PostKind = 'question' \| 'together' \| 'resident_story' \| 'life_report' \| 'greeting';/);
assert.match(api, /new Set<PostKind>\(\['question', 'together', 'resident_story', 'life_report', 'greeting'\]\)/);
assert.equal(/'hello'/.test(api), false, 'no hello slug or legacy alias enters the resident API');

console.log('Community C2 greeting kind contract PASS');
