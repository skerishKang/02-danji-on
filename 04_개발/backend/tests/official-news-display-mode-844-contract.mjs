import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [admin, attachment, migration, channel] = await Promise.all([
  readFile(new URL('src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('src/official-news-attachment-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/053_complex_news_article_reactions.sql', root), 'utf8'),
  readFile(new URL('src/complex-news-channel.ts', root), 'utf8')
]);

assert.match(migration, /display_mode text not null default 'highlight'/);
assert.match(migration, /display_mode in \('highlight', 'article'\)/);
assert.match(channel, /NEWS_DISPLAY_MODES = \['highlight', 'article'\]/);

assert.ok(admin.includes("const displayMode = String(payload.displayMode ?? 'highlight').trim();"),
  'create defaults only to the legacy highlight mode');
assert.ok(admin.includes("displayMode !== 'highlight' && displayMode !== 'article'"),
  'create/patch must reject unknown display modes');
assert.ok(admin.includes("return fail('INVALID_DISPLAY_MODE', 'Invalid display mode', 400, requestId)"),
  'unknown modes fail closed at the server boundary');
assert.ok(admin.includes('attachment_object_key, status, published_at, channel, display_mode'),
  'plain post create persists display_mode');
assert.ok(admin.includes('channel = ${channel}, display_mode = ${displayMode}'),
  'plain post patch persists display_mode');
assert.match(admin, /select p\.id, p\.source_name, p\.category, p\.channel, p\.display_mode, p\.title, p\.body,/,
  'admin readback must expose the persisted display mode');

assert.ok(attachment.includes("displayMode: 'highlight' | 'article'"),
  'atomic attachment write accepts only the bounded display-mode union');
assert.ok(attachment.includes('attachment_object_key, status, published_at, channel, display_mode'),
  'attachment create persists display_mode inside the same lock-protected write');
assert.ok(attachment.includes('${write.channel},\n      ${write.displayMode}'),
  'attachment create carries the caller mode into the SQL write');
assert.ok(attachment.includes('display_mode = ${write.displayMode}'),
  'attachment update persists display_mode inside the lock-protected write');
assert.equal((attachment.match(/display_mode/g) || []).length >= 4, true,
  'attachment create/update/readback keep display_mode end to end');

console.log('OFFICIAL_NEWS_DISPLAY_MODE_CREATE=PASS');
console.log('OFFICIAL_NEWS_DISPLAY_MODE_PATCH=PASS');
console.log('OFFICIAL_NEWS_ATTACHMENT_DISPLAY_MODE=PASS');
console.log('official-news-display-mode-844-contract: PASS');
