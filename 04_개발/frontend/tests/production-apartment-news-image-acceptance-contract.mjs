import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const [workflow, script, admin, bridge, detail, backend, attachment] = await Promise.all([
  readFile(new URL('.github/workflows/production-apartment-news-image-acceptance.yml', root), 'utf8'),
  readFile(new URL('04_개발/frontend/scripts/production-apartment-news-image-acceptance.mjs', root), 'utf8'),
  readFile(new URL('frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('frontend/08A_아파트소식_상세.html', root), 'utf8'),
  readFile(new URL('04_개발/backend/src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('04_개발/backend/src/official-news-attachment-v1.ts', root), 'utf8')
]);

for (const token of [
  'pull_request:',
  'workflow_dispatch:',
  'expected_main:',
  'run_live:',
  "github.event_name == 'workflow_dispatch' && inputs.run_live",
  'environment: production',
  'ref: main',
  'git ls-remote origin refs/heads/main',
  'PRODUCTION_844_EXACT_MAIN_GUARD=PASS'
]) assert.ok(workflow.includes(token), 'workflow missing gate: ' + token);

for (const token of [
  'DANJION_PRODUCTION_OPERATOR_EMAIL',
  'DANJION_PRODUCTION_OPERATOR_PASSWORD',
  'https://danjion.pages.dev'
]) assert.ok(workflow.includes(token), 'workflow missing bounded Production input: ' + token);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL: $' + '{{',
  'DATABASE_URL: $' + '{{',
  'CLOUDFLARE_API_TOKEN: $' + '{{',
  'CLOUDFLARE_ACCOUNT_ID: $' + '{{',
  'wrangler deploy',
  'pages deploy',
  'sign-up/email'
]) assert.ok(!workflow.includes(forbidden), 'workflow must not bind/perform: ' + forbidden);

for (const absence of [
  'test -z "' + '$' + '{DATABASE_URL:-}"',
  'test -z "' + '$' + '{DANJION_PRODUCTION_DB_URL:-}"',
  'test -z "' + '$' + '{CLOUDFLARE_API_TOKEN:-}"',
  'test -z "' + '$' + '{CLOUDFLARE_ACCOUNT_ID:-}"'
]) assert.ok(workflow.includes(absence), 'workflow must assert absence: ' + absence);

for (const path of [
  'admin/index.html',
  'assets/danjion-admin-console.js',
  'assets/danjion-admin-official-news-storage.js',
  '08A_아파트소식_상세.html'
]) assert.ok(script.includes("assertLiveParity('" + path + "'"), 'missing live parity: ' + path);
assert.ok(script.includes("redirect: 'follow'"));
assert.ok(script.includes('LIVE_PARITY_REDIRECT_TARGET_INVALID'));

assert.ok(script.includes("context.request.post("));
assert.ok(script.includes("/api/auth/sign-in/email"));
assert.ok(script.includes("/api/auth/get-session"));
for (const ui of [
  "getByRole('button', { name: '단지소식', exact: true })",
  "getByLabel('출처').first().fill('입주자대표회의')",
  "getByLabel('소식 채널').first().selectOption('apartment_news')",
  "getByLabel('표시 방식').first().selectOption('article')",
  "getByLabel('게시 상태').first().selectOption('published')",
  "getByLabel('공식소식 사진').first()",
  "getByRole('button', { name: '새 소식 저장', exact: true })"
]) assert.ok(script.includes(ui), 'live E2E missing UI action: ' + ui);

for (const marker of [
  'OFFICIAL_NEWS_PHOTO_SELECTED_LOCAL_ONLY',
  'OFFICIAL_NEWS_R2_UPLOAD_201',
  'SERVER_ISSUED_OBJECT_KEY',
  'OFFICIAL_POST_CREATE_201',
  'OFFICIAL_POST_DISPLAY_MODE_ARTICLE',
  'PUBLIC_POST_READBACK',
  'PUBLIC_ATTACHMENT_REFERENCE_MATCH',
  'PUBLIC_IMAGE_HTTP_200',
  'PUBLIC_IMAGE_LENGTH_MATCH',
  'PUBLIC_IMAGE_SHA256_MATCH',
  'PUBLIC_IMAGE_CONTENT_TYPE_SAFE',
  'ARTICLE_IMAGE_RENDERED',
  'ARTICLE_IMAGE_DECODED',
  'ARTICLE_TEXT_PRESERVED',
  'REFERENCED_OBJECT_DELETE_GUARD_409',
  'ACCEPTANCE_POST_ARCHIVED',
  'ARCHIVED_POST_PUBLIC_404',
  'ARCHIVED_IMAGE_PUBLIC_404',
  'PRODUCTION_844_APARTMENT_NEWS_IMAGE_ACCEPTANCE'
]) assert.ok(script.includes(marker), 'acceptance marker missing: ' + marker);

assert.ok(script.includes('08A_아파트소식_상세.html?post='));
assert.ok(script.includes('image.naturalWidth > 0') && script.includes('image.naturalHeight > 0'));
assert.ok(script.includes('sha256(imageBytes) !== sha256(PNG_BYTES)'));

assert.ok(script.includes("data: { status: 'archived' }"));
assert.ok(script.includes('FAILURE_POST_ARCHIVE_CLEANUP='));
assert.ok(script.includes('FAILURE_UNREFERENCED_OBJECT_CLEANUP='));
assert.ok(script.includes('AUTO_RETRY_FOR_MUTATIONS=0'));
assert.ok(!script.includes('for (let attempt'));
assert.ok(!script.includes('while (true)'));

for (const forbiddenLog of [
  'console.log(email',
  'console.log(password',
  'console.log(sessionJson',
  'console.log(objectKey',
  'console.log(postId',
  'storageState('
]) assert.ok(!script.includes(forbiddenLog), 'must not log sensitive/runtime identifier: ' + forbiddenLog);

for (const token of [
  'officialNewsStorage.uploadOfficialNewsImage(fetch,apiBase,image.file,image.idempotencyKey,consoleApi.COMPLEX_SLUG)',
  'displayMode:fields.displayMode.value',
  'attachmentObjectKey',
  "select.setAttribute('aria-label','표시 방식')"
]) assert.ok(admin.includes(token), 'canonical admin missing: ' + token);
for (const token of [
  "const POST_DISPLAY_MODES = Object.freeze(['highlight', 'article'])",
  "Object.prototype.hasOwnProperty.call(value, 'displayMode')",
  "...(hasDisplayMode ? { displayMode } : {})",
  'attachmentObjectKey'
]) assert.ok(bridge.includes(token), 'canonical admin bridge missing: ' + token);

assert.ok(backend.includes("!['highlight','article'].includes(displayMode)"));
assert.ok(backend.includes('validateOfficialNewsImageReference('));
assert.ok(backend.includes('insertOfficialNewsPostWithAttachment('));
assert.ok(backend.includes('display_mode = ') && backend.includes('displayMode'));
assert.ok(attachment.includes('display_mode'));
assert.ok(attachment.includes('write.displayMode'));

assert.ok(detail.includes("const ARTICLE_CHANNELS = new Set(['apartment_news', 'management_office'])"));
assert.ok(detail.includes('resolveOfficialNewsImageUrl(apiBase, post.attachmentObjectKey)'));
assert.ok(detail.includes("image.addEventListener('error', clearMedia)"));
assert.ok(detail.includes("post.displayMode !== 'article'"));

console.log('PRODUCTION_844_MANUAL_ONLY=PASS');
console.log('PRODUCTION_844_CANONICAL_ADMIN_UI=PASS');
console.log('PRODUCTION_844_PUBLIC_READBACK=PASS');
console.log('PRODUCTION_844_ARCHIVE_CLEANUP_BOUNDED=PASS');
console.log('production-apartment-news-image-acceptance-contract: PASS');
