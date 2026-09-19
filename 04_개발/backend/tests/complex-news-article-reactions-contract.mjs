// Issue #768 [Owner Product][Apartment News V3]: long-form board articles plus a
// server-authoritative 공감 action.
//
// This contract freezes the bounded slice that was actually implemented:
//   * one additive presentation-mode column (no backfill, legacy rows stay 'highlight')
//   * one additive reaction table, unique per resident per post per reaction type
//   * the public posts API exposes display_mode / authority / reaction_count
//   * a resident-only reaction endpoint that reads the count back from the DB
//   * no presentation mode is ever inferred from title/body length in the browser
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const flat = s => s.toLowerCase().replace(/\s+/g, ' ');

/* 1. migration 053 is additive and bounded. */
const rawMigration = read('migrations/053_complex_news_article_reactions.sql');
const migration = flat(rawMigration.replace(/^\s*--.*$/gm, ''));
assert.match(
  migration,
  /alter table complex_posts add column if not exists display_mode text not null default 'highlight';/
);
assert.match(migration, /add constraint chk_complex_posts_display_mode check \(display_mode in \('highlight', 'article'\)\)/);
assert.match(migration, /create table if not exists complex_post_reactions \(/);
assert.match(migration, /reaction_type text not null default 'like' check \(reaction_type in \('like'\)\)/);
assert.match(migration, /unique \(post_id, user_id, reaction_type\)/, 'one active reaction per resident per post is enforced by the DB');
assert.match(migration, /references complex_posts\(id\) on delete cascade/);
assert.match(migration, /references app_users\(id\) on delete cascade/);

// No destructive or data-mutating statement may sneak into this migration, and no
// backfill may rewrite a published post into the new renderer.
for (const forbidden of [/drop table/, /drop column/, /truncate/, /delete from/, /update\s+complex_posts/, /insert into/, /alter column/, /not null default 'article'/]) {
  assert.equal(forbidden.test(migration), false, `053 must stay bounded, found ${forbidden}`);
}
assert.match(rawMigration, /-- DOWN:[\s\S]*drop table if exists complex_post_reactions;/, 'the down path must stay documented');
// The original historical authorities stay untouched.
assert.equal(/display_mode/.test(flat(read('migrations/040_complex_news_channel.sql'))), false, '040 must stay the untouched channel authority');

/* 2. inventory stays contiguous and 053 ships for this leaf. */
const migrations = readdirSync(resolve(root, 'migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes('053_complex_news_article_reactions.sql'), '053 must ship for this leaf');
const production = migrations.filter(f => !/^(900|901|902)_/.test(f)).map(f => Number(f.split('_')[0])).sort((a, b) => a - b);
assert.deepEqual(production, Array.from({ length: production.at(-1) }, (_, i) => i + 1), 'production migrations must stay contiguous');

/* 3. safety ledger registration + full inventory bijection. */
const ledger = JSON.parse(read('migration-safety-ledger.json'));
const entry = ledger.migrations['053_complex_news_article_reactions.sql'];
assert.ok(entry, '053 must be registered in the migration safety ledger');
assert.equal(entry.class, 'schema');
assert.deepEqual(entry.marker, { kind: 'table', schema: 'public', name: 'complex_post_reactions' });
assert.equal(entry.marker.kind === undefined, false, 'a marker is required so the deploy gate can read back applied state');
for (const file of migrations) assert.ok(ledger.migrations[file], `ledger missing classification: ${file}`);
for (const file of Object.keys(ledger.migrations)) assert.ok(migrations.includes(file), `ledger references missing file: ${file}`);

/* 4. the production gate classifier accepts 053 and reads its marker. */
const { classifyMigration, markerToSql } = await import('../scripts/production-migration-gate.mjs');
assert.equal(classifyMigration(ledger, '053_complex_news_article_reactions.sql').class, 'schema');
assert.match(markerToSql(entry.marker), /complex_post_reactions/);
// 053 stays in the ordinary schema apply set: it is never an opt-in production seed.
assert.notEqual(entry.class, 'production_seed');
assert.equal(entry.opt_in_required, undefined, '053 must not require a production seed opt-in');

/* 5. long form needs no new column: the existing body bound already allows it. */
const constraints = flat(read('migrations/003_domain_constraints.sql'));
assert.match(constraints, /chk_post_body_length check \(char_length\(body\) between 1 and 10000\)/, 'the existing 10000-character body bound is the long-form capacity');

/* 6. the channel authority is server-derived, so the UI never hardcodes an organisation. */
const channel = read('src/complex-news-channel.ts');
assert.match(channel, /export const CHANNEL_AUTHORITY: Record<NewsChannel, string> = \{/);
assert.match(channel, /chair_greeting: 'resident_council_representative'/);
assert.match(channel, /apartment_news: 'resident_council'/);
assert.match(channel, /management_office: 'management_office'/);
assert.match(channel, /danjion_notice: 'danjion_operator'/);
assert.match(channel, /export const NEWS_DISPLAY_MODES = \['highlight', 'article'\] as const;/);
assert.match(channel, /export function displayModeFor\(value: unknown\): NewsDisplayMode \{/);
assert.match(channel, /return \(NEWS_DISPLAY_MODES as readonly string\[\]\)\.includes\(raw\) \? \(raw as NewsDisplayMode\) : 'highlight';/, 'an unknown display mode must fail closed to the popup, never to the reader');
assert.match(channel, /export function authorityFor\(channel: unknown\): string \{/);

/* 7. the public read lane exposes the mode, the authority and the server count. */
const core = read('src/core-v1.ts');
assert.match(core, /import \{ authorityFor \} from '\.\/complex-news-channel';/);
assert.match(core, /function mapNewsPost\(row: Record<string, unknown>\): Record<string, unknown> \{/);
assert.match(core, /return \{ \.\.\.row, authority: authorityFor\(row\.channel\) \};/);
const projections = core.match(/select p\.id, p\.source_name, p\.category, p\.channel, p\.display_mode, p\.title, p\.body,/g) ?? [];
assert.equal(projections.length, 2, 'both the list and the single-post read must project display_mode');
const counts = core.match(/\(select count\(\*\) from complex_post_reactions r\s*\n\s*where r\.post_id = p\.id and r\.reaction_type = 'like'\)::int as reaction_count/g) ?? [];
assert.equal(counts.length, 2, 'both the list and the single-post read must expose the server reaction count');
assert.equal(/reaction_count\s*=\s*\$\{/.test(core), false, 'no client-supplied reaction count may reach the public read');
assert.equal(/body\.length\s*[<>=]/.test(core), false, 'the list must never branch on body/title length to pick a renderer');

/* 8. the reaction lane is resident-only and reads its count back from the database. */
const reactions = read('src/complex-news-reactions-v1.ts');
assert.match(reactions, /export const NEWS_REACTION_PATH =\s*\n\s*'\/api\/v1\/complexes\/:slug\/news\/posts\/:postId\/reaction';/);
assert.match(reactions, /\\\/api\\\/v1\\\/complexes\\\/\(\[a-z0-9\]\[a-z0-9-\]\{0,119\}\)\\\/news\\\/posts\\\/\(\[0-9a-fA-F-\]\+\)\\\/reaction\$/, 'the handler must own exactly the /news/posts/:id/reaction route');
assert.match(reactions, /if \(request\.method !== 'GET' && request\.method !== 'POST' && request\.method !== 'DELETE'\) \{/);
assert.match(reactions, /const resident = await requireVerifiedResident\(request, env, sql, requestId, slug\);/);
assert.match(reactions, /if \(resident instanceof Response\) return resident;/, 'signed-out and unverified states must pass through the canonical boundary response');
assert.match(reactions, /and complex_id = \$\{resident\.complexId\}::uuid\s*\n\s*and status = 'published'/, 'reactions are scoped to a published post inside the resident complex');
assert.match(reactions, /insert into complex_post_reactions \(complex_id, post_id, user_id, reaction_type\)/);
assert.match(reactions, /on conflict \(post_id, user_id, reaction_type\) do nothing/, 'reacting twice must be idempotent');
assert.match(reactions, /delete from complex_post_reactions[\s\S]*?and user_id = \$\{resident\.id\}::uuid/, 'unreact must be scoped to the caller');
assert.match(reactions, /async function reactionState\(sql: Sql, complexId: string, postId: string, userId: string\) \{/);
assert.equal((reactions.match(/return ok\(await reactionState\(/g) ?? []).length, 3, 'every response (read/react/unreact) returns the DB count, never a client value');
assert.match(reactions, /reactionCount: Number\(row\.reaction_count \?\? 0\)/);
assert.doesNotMatch(reactions, /bodyJson\(/, 'the reaction lane takes no client payload that could fabricate a count');
assert.doesNotMatch(reactions, /attachment_object_key|media|photo/, 'media intake belongs to #766 and must not be invented here');

/* 9. app.ts wires the resident lane ahead of the public core fallback. */
const app = read('src/app.ts');
assert.match(app, /import \{ handleComplexNewsReactionRequest \} from '\.\/complex-news-reactions-v1';/);
const wired = app.indexOf('await handleComplexNewsReactionRequest(request, env, id)');
const fallback = app.indexOf('return respond(await core.fetch(request, env));');
assert.ok(wired > -1 && fallback > -1 && wired < fallback, 'the resident reaction lane must be reachable before the public fallback');

console.log('Complex news article + reaction contract PASS');
