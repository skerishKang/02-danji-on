import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, core, initialSchema] = await Promise.all([
  readFile(new URL('migrations/041_business_category_benefit_contract.sql', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/001_initial_schema.sql', root), 'utf8')
]);

// (A) Legacy single-category businesses keep working: the primary column is never dropped.
assert.match(initialSchema, /category_id uuid references business_categories\(id\)/,
  '001 schema defines the legacy single primary category');
assert.ok(!/drop column.*category_id/i.test(migration),
  'migration must not drop businesses.category_id (backward compatibility)');

// The migration is additive only: no destructive statements outside DOWN comments.
const activeMigration = migration
  .split('-- DOWN:')[0]
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
assert.doesNotMatch(activeMigration, /drop\s+(table|column|index|constraint)\b/i,
  '041 active statements must contain no DROP');
assert.doesNotMatch(activeMigration, /truncate\b/i,
  '041 must not truncate');
assert.doesNotMatch(activeMigration, /delete\s+from\b/i,
  '041 must not delete rows');
assert.doesNotMatch(activeMigration, /\bupdate\s+\w+\s+set\b/i,
  '041 must not mass-update rows');

// (B) MULTI_CATEGORY: join table with both FKs, unique pair, discovery index.
assert.match(migration, /create table if not exists business_category_relations \(/i,
  'multi-category join table must be created');
assert.match(migration, /business_id uuid not null references businesses\(id\) on delete cascade/,
  'join table must FK businesses');
assert.match(migration, /category_id uuid not null references business_categories\(id\) on delete cascade/,
  'join table must FK business_categories');
assert.match(migration, /unique \(business_id, category_id\)/,
  'no duplicate category relation per business');
assert.match(migration, /create index if not exists idx_business_category_relations_business/i,
  'discovery lookup index by business must exist');
assert.match(migration, /create index if not exists idx_business_category_relations_category/i,
  'category-first lookup index must exist');

// (C) BENEFIT_VALUE: nullable display-value column, exact product copy semantics.
assert.match(migration, /alter table benefits add column if not exists value_text text/i,
  'benefits.value_text must be added, nullable');
assert.ok(!/value_text text not null/i.test(migration),
  'value_text must stay nullable for legacy rows');
assert.match(migration, /comment on column benefits\.value_text[\s\S]*Not a settlement calculation/,
  'value_text documented as product display copy, not settlement logic');

// (D) BENEFIT_CODE: nullable, deliberately non-unique, indexed, no redemption semantics.
assert.match(migration, /alter table benefits add column if not exists code text/i,
  'benefits.code must be added, nullable');
{
  // Strip both line comments and the quoted string bodies of comment-on statements,
  // so documentation text cannot trigger structural assertions.
  const structuralSql = migration
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/'[^']*'/g, "''");
  assert.ok(!/unique\s*\(([^)]*\bcode\b)/i.test(structuralSql),
    'code must NOT be listed inside a UNIQUE constraint');
  assert.ok(!/add\s+(unique\s+)?constraint[^;]*code/i.test(structuralSql),
    'no named UNIQUE constraint may reference code');
  assert.ok(!/create\s+unique\s+index[^;]*code/i.test(structuralSql),
    'no UNIQUE INDEX may be created on code');
}
assert.match(migration, /create index if not exists idx_benefits_code on benefits \(code\)/i,
  'code lookup index must exist');
assert.match(migration, /comment on column benefits\.code[\s\S]*no redemption semantics implied/,
  'code documented with no redemption semantics');

// (E) Migration documents a reversible DOWN step, per 040 convention.
assert.match(migration, /-- DOWN:[\s\S]*drop index if exists idx_benefits_code[\s\S]*drop table if exists business_category_relations/i,
  'DOWN block must reverse all objects');

// (F) Public discovery list returns additive fields without renaming existing ones.
assert.match(core, /bc\.slug as category_slug, bc\.name as category_name,/,
  'existing category_slug/category_name fields must be preserved verbatim');
assert.match(core, /\) as categories,/,
  'list select must add a categories array field');
assert.match(core, /select array_agg\(bcr_cat\.slug order by bcr_cat\.sort_order, bcr_cat\.slug\)/,
  'categories must aggregate join-table slugs in canonical order');
assert.match(core, /case when bc\.slug is not null then array\[bc\.slug\] else array\[\]::text\[\] end/,
  'legacy rows without join rows must fall back to the primary category slug');
assert.match(core, /coalesce\(/,
  'categories must coalesce join rows over the primary fallback');

// (G) Category filter honors multi-category membership (legacy behavior preserved).
assert.match(core, /or exists \([\s\S]*from business_category_relations bcr[\s\S]*\(bcr_cat\.slug = \$\{category\} or bcr_cat\.name = \$\{category\}\)[\s\S]*\n\s*\)\)/,
  'category filter must also match secondary categories');

// (H) active_benefit payload exposes value + code additively, keeping existing keys.
assert.match(core, /'value', be\.value_text,/,
  'active_benefit must include value');
assert.match(core, /'code', be\.code,/,
  'active_benefit must include code');
assert.match(core, /'conditions', be\.conditions,/,
  'existing conditions key must remain');

// (I) Detail endpoint + benefits list expose the new columns additively,
//     with the SAME external value key as active_benefit.
assert.match(core, /select id, title, description, conditions, value_text as value, code, starts_at, ends_at[\s\S]*from benefits/,
  'detail benefits select must alias value_text to the external value key');
assert.match(core, /select be\.id, be\.title, be\.description, be\.conditions, be\.value_text as value, be\.code,/,
  'public benefits list must alias value_text to the external value key');

// (I2) API_BENEFIT_VALUE_FIELD_CONSISTENT: all three external surfaces use
//      key `value`; no surface may leak the raw value_text key to clients.
{
  const surfaces = [
    ['active_benefit', /'value', be\.value_text,/],
    ['detail benefits', /value_text as value, code, starts_at, ends_at/],
    ['public benefits', /be\.value_text as value/]
  ];
  for (const [name, re] of surfaces) {
    assert.ok(re.test(core), `${name} must expose the external value key`);
  }
  // No benefit payload field is named value_text externally:
  // the only permitted value_text occurrences are the DB column reads above.
  assert.ok(!/'value_text'/.test(core),
    'no JSON key may be named value_text in API payloads');
}

// (J) Ordering and relation semantics are untouched.
assert.match(core, /order by case r\.relation_type[\s\S]*when 'resident' then 0[\s\S]*when 'resident_family' then 1[\s\S]*when 'neighbor' then 2/,
  'relation ordering must remain resident → resident_family → neighbor');
assert.match(core, /r\.priority asc,[\s\S]*b\.created_at desc/,
  'secondary ordering must remain priority asc, created_at desc');

console.log('PASS #278 business category and benefit contract');
