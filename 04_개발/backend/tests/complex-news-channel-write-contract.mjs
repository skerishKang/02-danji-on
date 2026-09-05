import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NEWS_CHANNELS } from '../src/core-v1.ts';
import { SOURCE_CHANNEL, deriveChannel } from '../src/complex-news-channel.ts';

const root = new URL('../', import.meta.url);
const migration = await readFile(new URL('migrations/040_complex_news_channel.sql', root), 'utf8');

// (1) Explicit enum wins over source derivation.
assert.equal(deriveChannel('단지온 운영자', 'management_office'), 'management_office',
  'explicit enum must win over source_name mapping');
assert.equal(deriveChannel('관리사무소', 'apartment_news'), 'apartment_news',
  'explicit apartment_news must win over 관리사무소 mapping');
assert.equal(deriveChannel('모르는 출처', 'chair_greeting'), 'chair_greeting',
  'explicit chair_greeting must win over unmapped source');

// (2) Unknown explicit enum → null (caller maps to 400 INVALID_CHANNEL).
assert.equal(deriveChannel('단지온 운영자', 'committee_staff'), null,
  'unknown explicit enum must reject with null (400 INVALID_CHANNEL)');
assert.equal(deriveChannel('아무 출처', 'mystery_channel'), null,
  'unknown explicit enum must reject regardless of source');

// (3) Chain derivation from source_name.
assert.equal(deriveChannel('단지온 운영자'), 'danjion_notice',
  '단지온 운영자 must derive danjion_notice');
assert.equal(deriveChannel('관리사무소'), 'management_office',
  '관리사무소 must derive management_office');
assert.equal(deriveChannel('기타 운영진'), 'apartment_news',
  'unmapped source must default to apartment_news');
assert.equal(deriveChannel(''), 'apartment_news',
  'empty source must default to apartment_news');
assert.equal(deriveChannel('단지온 운영자', undefined), 'danjion_notice',
  'undefined explicit must fall back to source derivation');
assert.equal(deriveChannel('단지온 운영자', null), 'danjion_notice',
  'null explicit must fall back to source derivation');
assert.equal(deriveChannel('단지온 운영자', ''), 'danjion_notice',
  'empty explicit must fall back to source derivation');
assert.equal(deriveChannel('단지온 운영자', '   '), 'danjion_notice',
  'whitespace explicit must fall back to source derivation');

// (4) Write path and backfill (040) must share the same constants.
for (const [source, channel] of Object.entries(SOURCE_CHANNEL)) {
  assert.ok(migration.includes(`source_name = '${source}'`),
    `migration 040 must backfill source ${source}`);
  assert.ok(migration.includes(`channel = '${channel}'`),
    `migration 040 must backfill channel ${channel}`);
  assert.equal(deriveChannel(source), channel,
    `deriveChannel(${source}) must match migration 040 mapping`);
}
assert.ok(migration.includes("channel = 'apartment_news'"),
  'migration 040 must keep the apartment_news default');

for (const channel of NEWS_CHANNELS) {
  assert.ok(Object.values(SOURCE_CHANNEL).includes(channel) || channel === 'apartment_news' || channel === 'chair_greeting',
    `every enum member must be reachable: ${channel}`);
}

console.log('PASS #246 complex-news channel write contract');
