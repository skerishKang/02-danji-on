// Issue #767 (reported from #762 owner live QA round 2): canonical Community post
// category (말머리) persistence. Proves the bounded schema extension, the ledger
// registration the production gate requires, and the server-authoritative
// allowlist that the V3 write screens must mirror.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const flat = s => s.toLowerCase().replace(/\s+/g, ' ');

/* 1. migration 052 is additive and bounded: one nullable column, one named check. */
const migration = flat(read('migrations/052_community_post_category.sql').replace(/^\s*--.*$/gm, ''));
assert.match(migration, /alter table community_posts add column if not exists category text;/);
assert.match(migration, /alter table community_posts drop constraint if exists community_posts_category_check;/);
assert.match(migration, /add constraint community_posts_category_check check \(category is null or char_length\(category\) between 1 and 40\)/);
for (const forbidden of [/drop table/, /drop column/, /truncate/, /delete from/, /update\s/, /alter column/, /create index/, /drop index/, /do\s+\$\$/, /insert into/]) {
  assert.equal(forbidden.test(migration), false, `052 must stay bounded, found ${forbidden}`);
}
assert.equal(/not null/.test(migration), false, '050 category stays nullable so existing rows and greeting/story never need a backfill');

/* 2. historical migrations stay untouched: 013 keeps the original column set. */
const base = flat(read('migrations/013_community_core.sql'));
assert.equal(/category/.test(base), false, '013 must stay the untouched historical authority');

/* 3. inventory stays contiguous and 052 ships for this leaf. */
const migrations = readdirSync(resolve(root, 'migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes('052_community_post_category.sql'), '052 must ship for this leaf');
const production = migrations.filter(f => !/^(900|901|902)_/.test(f)).map(f => Number(f.split('_')[0])).sort((a, b) => a - b);
assert.deepEqual(production, Array.from({ length: production.at(-1) }, (_, i) => i + 1), 'production migrations must stay contiguous');

/* 4. safety ledger registration and full inventory sync (the gate fails closed otherwise). */
const ledger = JSON.parse(read('migration-safety-ledger.json'));
const entry = ledger.migrations['052_community_post_category.sql'];
assert.ok(entry, '052 must be registered in the migration safety ledger');
assert.equal(entry.class, 'schema');
assert.deepEqual(entry.marker, { kind: 'column', table: 'community_posts', name: 'category' });
for (const file of migrations) assert.ok(ledger.migrations[file], `ledger missing classification: ${file}`);
for (const file of Object.keys(ledger.migrations)) assert.ok(migrations.includes(file), `ledger references missing file: ${file}`);

/* 5. the production gate classifier accepts 052 and reads its marker. */
const { classifyMigration, markerToSql } = await import('../scripts/production-migration-gate.mjs');
assert.equal(classifyMigration(ledger, '052_community_post_category.sql').class, 'schema');
assert.match(markerToSql(entry.marker), /information_schema\.columns/);
assert.match(markerToSql(entry.marker), /community_posts/);
assert.match(markerToSql(entry.marker), /'category'/);

/* 6. the resident API owns the canonical per-kind allowlist. */
const api = read('src/community-resident-v1.ts');
assert.match(api, /const POST_CATEGORIES: Partial<Record<PostKind, readonly string\[\]>> = \{\n  question: \['생활·살림', '단지시설', '이웃추천', '기타'\],\n  together: \['산책·운동', '취미활동', '육아 같이해요', '공동구매'\]\n\};/);
assert.match(api, /const MAX_CATEGORY_CHARS = 40;/);
assert.match(api, /function resolveCategory\(kind: PostKind, raw: string, requestId: string\): string \| null \| Response \{/);
assert.match(api, /if \(!allowlist \|\| !allowlist\.includes\(raw\)\) \{/, 'a value outside the kind allowlist must fail closed');
assert.match(api, /Category is not part of the canonical list for this post kind/, 'rejection copy stays explicit');

/* 7. create persists the category and every projection that mapPost consumes reads it back. */
assert.match(api, /insert into community_posts \(complex_id, author_user_id, kind, title, body, category, status, published_at\)/);
assert.match(api, /returning id, kind, category, title, body, status, published_at, created_at, updated_at/);
assert.match(api, /category: row\.category \? String\(row\.category\) : null,/);
const projections = api.match(/select p\.id, p\.kind, p\.category, p\.title, p\.body, p\.status/g) ?? [];
assert.equal(projections.length, 3, 'feed(kind)/feed(all)/single-post reads must all project the category');
assert.equal((api.match(/returning id, kind, category,/g) ?? []).length, 2, 'create and edit readback must both return the category');
// An edit never rewrites the 말머리: PATCH still sets title/body only.
assert.doesNotMatch(api, /set title = \$\{title\}, body = \$\{body\}, category =/);
assert.doesNotMatch(api, /building_code|unit_code|resident_code|evidence_object_key/i);

console.log('Community C2 post category contract PASS');
