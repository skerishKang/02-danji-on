import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const migration = readFileSync(resolve(here, '../migrations/013_community_core.sql'), 'utf8');
const normalized = migration.toLowerCase().replace(/\s+/g, ' ');

const expectedTables = [
  'community_posts',
  'community_comments',
  'community_reactions',
  'community_reports',
  'community_moderation_events'
];

for (const table of expectedTables) {
  assert.match(normalized, new RegExp(`create table if not exists ${table}`), `${table} must be created by migration 013`);
}

assert.doesNotMatch(normalized, /create table if not exists boards\b/, 'C2 must not introduce a generic boards domain');
assert.doesNotMatch(normalized, /alter table complex_posts|drop table.*complex_posts|create table if not exists complex_posts/, 'C2 must not mutate official complex_posts');

assert.match(normalized, /kind text not null check \(kind in \('question','together','resident_story','life_report'\)\)/);
assert.match(normalized, /visibility text not null default 'verified_residents' check \(visibility in \('verified_residents'\)\)/);
assert.match(normalized, /status text not null default 'pending_review' check \(status in \('pending_review','published','hidden','deleted'\)\)/);
assert.match(normalized, /check \(char_length\(body\) between 1 and 300\)/, 'comment body must preserve the approved 300-character limit');

assert.match(normalized, /foreign key \(post_id, complex_id\) references community_posts\(id, complex_id\) on delete cascade/);
assert.match(normalized, /foreign key \(comment_id, complex_id\) references community_comments\(id, complex_id\) on delete cascade/);
assert.match(normalized, /unique \(post_id, user_id, reaction_type\)/, 'same reaction must be unique per user and post');

const exactOneTarget = /check \(\(post_id is not null\)::integer \+ \(comment_id is not null\)::integer = 1\)/g;
assert.equal((normalized.match(exactOneTarget) ?? []).length, 2, 'reports and moderation events must target exactly one post or comment');

assert.match(normalized, /uq_community_open_post_report_per_user/);
assert.match(normalized, /uq_community_open_comment_report_per_user/);
assert.match(normalized, /idx_community_posts_feed/);
assert.match(normalized, /idx_community_comments_post/);

for (const forbidden of ['building_code', 'unit_code', 'phone', 'mobile', 'auth_user_id', 'provider_identity', 'email']) {
  assert.equal(normalized.includes(forbidden), false, `Community schema must not add resident PII field: ${forbidden}`);
}

assert.doesNotMatch(normalized, /do\s+\$\$/i, 'migration 013 must remain compatible with the validated Neon migration runner');
assert.match(normalized, /drop trigger if exists trg_community_posts_updated_at/);
assert.match(normalized, /create trigger trg_community_reports_updated_at/);

console.log('Community C2 schema contract PASS');
