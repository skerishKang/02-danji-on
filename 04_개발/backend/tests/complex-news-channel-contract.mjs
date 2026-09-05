import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [migration, core] = await Promise.all([
  readFile(new URL('migrations/040_complex_news_channel.sql', root), 'utf8'),
  readFile(new URL('src/core-v1.ts', root), 'utf8')
]);

const CHANNELS = ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'];

for (const channel of CHANNELS) {
  assert.ok(migration.includes(`'${channel}'`), `migration must enumerate ${channel}`);
}
assert.match(migration, /add column if not exists channel text not null default 'apartment_news'/i,
  'channel must be added with the approved apartment_news backfill default');
assert.match(migration, /check \(channel in \('danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'\)\)/i,
  'channel must be constrained to the 06/07/08/09 enum');
assert.match(migration, /update complex_posts set channel = 'danjion_notice'[\s\S]*source_name/i,
  'existing rows must be backfilled by authoritative source_name only');
assert.match(migration, /drop constraint if exists[\s\S]*drop column if exists channel/i,
  'migration must document a reversible DOWN step');
assert.doesNotMatch(migration, /resident_news/i,
  'official-news channel must never touch the resident-news store');

assert.match(core, /NEWS_CHANNELS = \['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'\]/,
  'public core must pin the same server-authoritative enum');
assert.match(core, /channelFilter\(url\.searchParams\.get\('channel'\)\)/,
  'posts list must accept a ?channel= filter');
assert.match(core, /INVALID_CHANNEL[\s\S]*Invalid channel filter[\s\S]*400/,
  'an unknown channel value must return 400');
assert.match(core, /select p\.id, p\.source_name, p\.category, p\.channel, p\.title, p\.body,/,
  'list/detail selects must expose the server-authoritative channel');
assert.match(core, /or p\.channel = \$\{channel\}/,
  'list route must filter rows by the channel value');
assert.doesNotMatch(core, /resident_news_posts/i,
  'public core must not gain resident-news access');

console.log('PASS #257 complex-news channel contract');
