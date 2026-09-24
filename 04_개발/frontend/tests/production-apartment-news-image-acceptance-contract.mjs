import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const [workflow, script, admin, adminBridge, backend, attachment, detail, bridge] = await Promise.all([
  readFile(new URL('.github/workflows/production-apartment-news-image-acceptance.yml', root), 'utf8'),
  readFile(new URL('04_개발/frontend/scripts/production-apartment-news-image-acceptance.mjs', root), 'utf8'),
  readFile(new URL('frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('04_개발/backend/src/admin-operational-v2.ts', root), 'utf8'),
  readFile(new URL('04_개발/backend/src/official-news-attachment-v1.ts', root), 'utf8'),
  readFile(new URL('frontend/08A_아파트소식_상세.html', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-news-bridge.js', root), 'utf8'),
]);

// Manual-only Production mutation: PRs exercise source contract but never the live job.
assert.match(workflow, /pull_request:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /run_live:/);
assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_live/);
assert.match(workflow, /environment:\s*production/);
assert.match(workflow, /ref:\s*main/);
assert.match(workflow, /git ls-remote origin refs\/heads\/main/);
assert.match(workflow, /PRODUCTION_844_EXACT_MAIN_GUARD=PASS/);
assert.match(workflow, /PRODUCTION_844_ONE_OPERATOR_GUARD=PASS/);
assert.match(workflow, /PRODUCTION_844_UNAUTHORIZED_PRINCIPAL_GUARD=PASS/);
assert.match(workflow, /PRODUCTION_844_TEST_PERSONA_GUARD=PASS/);

for (const token of [
  'DANJION_PRODUCTION_TEST_OPERATIONAL_EMAIL',
  'DANJION_PRODUCTION_TEST_OPERATIONAL_PASSWORD',
  'DANJION_PRODUCTION_TEST_RESIDENT_EMAIL',
  'DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD',
  'DANJION_PRODUCTION_OPERATOR_EMAIL',
  'DANJION_PRODUCTION_OPERATOR_PASSWORD',
  'DANJION_PRODUCTION_25A_EMAIL',
  'DANJION_PRODUCTION_25A_PASSWORD',
  'https://danjion.pages.dev',
]) assert.ok(workflow.includes(token), `workflow must bind ${token}`);

for (const forbidden of [
  'DANJION_PRODUCTION_DB_URL: ${{',
  'DATABASE_URL: ${{',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'wrangler deploy',
  'pages deploy',
  'sign-up/email',
]) assert.ok(!workflow.includes(forbidden), `workflow must not contain ${forbidden}`);

assert.match(workflow, /test -z "\$\{DATABASE_URL:-\}"/);
assert.match(workflow, /test -z "\$\{DANJION_PRODUCTION_DB_URL:-\}"/);

// The deployed top-level Production admin must own the actual picker + upload path.
assert.ok(admin.includes("imageInput.type='file'"));
assert.ok(admin.includes("imageInput.setAttribute('aria-label','대표 사진')"));
assert.ok(admin.includes("consoleApi.uploadOfficialNewsImage("));
assert.ok(admin.includes("postDisplayModeSelect"));
assert.ok(admin.includes("['article','상세 글 (아파트소식 상세)']"));
assert.ok(admin.includes('displayMode:fields.displayMode.value'));
assert.ok(adminBridge.includes('async function uploadOfficialNewsImage('));
assert.ok(adminBridge.includes("form.append('kind', 'official-news-image')"));
assert.ok(adminBridge.includes("credentials: 'include'"));
assert.ok(adminBridge.includes("const POST_DISPLAY_MODES = Object.freeze(['highlight', 'article'])"));

// Server writes must persist the article mode in both ordinary and lock-protected attachment paths.
assert.ok(backend.includes("const displayMode = String(payload.displayMode ?? 'highlight').trim();"));
assert.ok(backend.includes("displayMode !== 'highlight' && displayMode !== 'article'"));
assert.ok(backend.includes('attachment_object_key, status, published_at, channel, display_mode'));
assert.ok(backend.includes('channel = ${channel}, display_mode = ${displayMode}'));
assert.ok(attachment.includes("displayMode: 'highlight' | 'article'"));
assert.ok(attachment.includes('display_mode = ${write.displayMode}'));

// Public article surface remains server-authoritative.
assert.ok(detail.includes("post.displayMode !== 'article'"));
assert.ok(detail.includes('resolveOfficialNewsImageUrl(apiBase, post.attachmentObjectKey)'));
assert.ok(detail.includes("loadArticle(new URLSearchParams(location.search).get('post') || '')"));
assert.ok(bridge.includes('OFFICIAL_NEWS_IMAGE_KEY'));
assert.ok(bridge.includes('resolveOfficialNewsImageUrl'));

// Live script must use the real Production UI for authoring and then prove public bytes/browser rendering.
for (const marker of [
  'LIVE_ADMIN_SOURCE_BYTE_PARITY',
  'LIVE_08A_SOURCE_BYTE_PARITY',
  'LIVE_NEWS_BRIDGE_BYTE_PARITY',
  'SIGNED_OUT_UPLOAD_DENIED_401',
  'SIGNED_OUT_POST_DENIED_401',
  'UNAUTHORIZED_WRITE_DENIED',
  'TEST_RESIDENT_OFFICIAL_WRITE_DENIED',
  'TEST_OPERATIONAL_SIGNIN',
  'TEST_OPERATIONAL_OFFICIAL_CONTENT_AUTHORITY',
  'OFFICIAL_CONTENT_AUTHORITY',
  'PRODUCTION_ADMIN_POST_COMPOSER_VISIBLE',
  'OFFICIAL_NEWS_PHOTO_PICKER',
  'ARTICLE_MODE_SELECTED',
  'OFFICIAL_NEWS_UPLOAD_201',
  'SERVER_ISSUED_OBJECT_KEY',
  'OBJECT_KIND=official-news-image',
  'UNREFERENCED_PUBLIC_IMAGE_DENIED_404',
  'OFFICIAL_POST_CREATE_201',
  'POST_DISPLAY_MODE_ARTICLE',
  'PUBLIC_POST_ATTACHMENT_READBACK',
  'PUBLIC_IMAGE_HTTP_200',
  'PUBLIC_IMAGE_BYTE_LENGTH_MATCH',
  'PUBLIC_IMAGE_SHA256_MATCH',
  'PUBLIC_IMAGE_CONTENT_TYPE_SAFE',
  'R2_OBJECT_EXISTS',
  'ARTICLE_IMAGE_RENDERED',
  'ARTICLE_IMAGE_RESPONSIVE',
  'ARTICLE_TEXT_PRESERVED',
  'NO_ATTACHMENT_TEXT_ONLY_REGRESSION',
  'DETACHED_IMAGE_PUBLIC_DENIED_404',
  'OFFICIAL_NEWS_IMAGE_RETIRED',
  'RETENTION_DISPOSITION=DETACH_THEN_RETIRE',
  'ACCEPTANCE_POST_ARCHIVED',
  'PUBLIC_POST_REMOVED_AFTER_ARCHIVE',
  'PRODUCTION_844_APARTMENT_NEWS_IMAGE_ACCEPTANCE',
]) assert.ok(script.includes(marker), `missing live acceptance marker: ${marker}`);

assert.ok(script.includes("getByLabel('대표 사진'"));
assert.ok(script.includes("selectOption('article')"));
assert.ok(script.includes('/api/v1/storage/public?objectKey='));
assert.ok(script.includes('/api/v1/admin/posts/'));
assert.ok(script.includes("status: 'archived'"));
assert.ok(script.includes('AUTO_RETRY_FOR_MUTATIONS=0'));
assert.ok(script.includes('SECRET_OUTPUT=0'));

// No secret, email, password, object key or post id may be logged.
for (const forbiddenLog of [
  'console.log(email',
  'console.log(password',
  'console.log(objectKey',
  'console.log(postId',
  'console.error(objectKey',
  'console.error(postId',
]) assert.ok(!script.includes(forbiddenLog), `script must not emit ${forbiddenLog}`);

console.log('production-apartment-news-image-acceptance-contract: PASS');
