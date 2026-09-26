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

// Live harness must target the actual accessible names exposed by the deployed V3 admin controls.
assert.ok(admin.includes("const editor=el('section',undefined,'admin-post-editor create')"));
assert.ok(script.includes("const composer = page.locator('section.admin-post-editor.create')"));
assert.ok(script.includes("composer.getByLabel('출처', { exact: true })"));
assert.ok(script.includes("composer.getByRole('button', { name: '새 소식 저장', exact: true })"));
assert.ok(!script.includes("await page.getByLabel('출처', { exact: true }).fill('입주자대표회의')"));
assert.ok(admin.includes("title.setAttribute('aria-label','소식 제목')"));
assert.ok(admin.includes("body.setAttribute('aria-label','소식 본문')"));
assert.ok(script.includes("getByLabel('소식 제목', { exact: true })"));
assert.ok(script.includes("getByLabel('소식 본문', { exact: true })"));
assert.ok(!script.includes("getByLabel('제목', { exact: true }).fill(title)"));
assert.ok(!script.includes("getByLabel('본문', { exact: true }).fill(body)"));


// #1064: a Product failure after mutation starts must reconcile exact server-issued residue
// before the authenticated context is closed. No broad marker/title sweep is permitted.
const reconciliationStart = script.indexOf('async function reconcileFailureResidue()');
const reconciliationEnd = script.indexOf('\n\ntry {', reconciliationStart);
assert.ok(reconciliationStart >= 0 && reconciliationEnd > reconciliationStart, '#1064 reconciliation helper must exist');
const reconciliation = script.slice(reconciliationStart, reconciliationEnd);
assert.ok(reconciliation.includes('FAILURE_CLEANUP_RECONCILIATION_ATTEMPTED'));
assert.ok(reconciliation.includes('FAILURE_CLEANUP_DETACH_RECONCILED'));
assert.ok(reconciliation.includes('FAILURE_CLEANUP_OBJECT_RETIRED'));
assert.ok(reconciliation.includes('FAILURE_CLEANUP_POST_ARCHIVE_ATTEMPTED'));
assert.ok(reconciliation.includes('FAILURE_CLEANUP_PUBLIC_POST_404_READBACK'));
assert.ok(reconciliation.includes("status: 'archived'"));
assert.ok(reconciliation.includes("attachmentObjectKey: null"));
assert.ok(reconciliation.includes('[200, 404]'));
assert.ok(reconciliation.includes('[404]'));
assert.ok(reconciliation.includes('if (postId)'));
assert.ok(reconciliation.includes('if (objectKey)'));
assert.equal(reconciliation.includes('#844 Production image E2E'), false, 'failure cleanup must not search by generated title');
assert.equal(/like\s+['"]%/i.test(reconciliation), false, 'failure cleanup must not use broad pattern matching');
assert.equal(/database|sql|select\s|delete\s+from/i.test(reconciliation), false, 'failure cleanup must not access DB directly');

const finalizerStart = script.indexOf('} finally {');
assert.ok(finalizerStart >= 0, '#1064 finalizer must exist');
const finalizer = script.slice(finalizerStart);
assert.ok(finalizer.includes('if (mutationStarted && !cleanupComplete && context)'));
assert.ok(finalizer.includes('await reconcileFailureResidue()'));
assert.ok(finalizer.indexOf('await reconcileFailureResidue()') < finalizer.indexOf('await context.close()'),
  'failure reconciliation must run before context close');

const archiveAt = reconciliation.indexOf("'ARCHIVE_POST'");
const detachAt = reconciliation.indexOf("'DETACH'");
const retireAt = reconciliation.indexOf("'RETIRE_OBJECT'");
assert.ok(archiveAt >= 0 && detachAt > archiveAt,
  'failure reconciliation must archive before detach so cleanup never republishes visibility');
assert.ok(retireAt > detachAt,
  'object retirement must remain a separate bounded step after detach');

for (const forbiddenIdOutput of [
  'console.log(postId',
  'console.log(objectKey',
  'console.error(postId',
  'console.error(objectKey',
]) assert.ok(!script.includes(forbiddenIdOutput), `#1064 must not emit ${forbiddenIdOutput}`);

console.log('production-apartment-news-image-failure-reconciliation-contract: PASS');


// #1067: failure reconciliation is monotonic toward non-visible state.
// It must archive before detach, never write published, preserve server status on detach,
// and retire the object only after the exact post reference is detached.
{
  const start = script.indexOf('async function reconcileFailureResidue()');
  const end = script.indexOf('\n\ntry {', start);
  assert.ok(start >= 0 && end > start, '#1067 reconciliation helper must exist');
  const block = script.slice(start, end);
  const archivePos = block.indexOf("'ARCHIVE_POST'");
  const detachPos = block.indexOf("'DETACH'");
  const retirePos = block.indexOf("'RETIRE_OBJECT'");
  const readbackPos = block.indexOf("'PUBLIC_POST_READBACK'");
  assert.ok(archivePos >= 0 && detachPos > archivePos, '#1067 archive must precede detach');
  assert.ok(retirePos > detachPos, '#1067 object retirement must follow detach');
  assert.ok(readbackPos > retirePos, '#1067 public readback must follow bounded cleanup attempts');
  assert.equal(block.includes("status: 'published'"), false, '#1067 failure reconciler must never publish');
  const detachSlice = block.slice(detachPos, retirePos);
  assert.equal(detachSlice.includes('status:'), false, '#1067 detach must preserve current server-authoritative status');
  assert.ok(block.includes("status: 'archived'"), '#1067 exact post archive must remain explicit');
  assert.ok(block.includes('attachmentObjectKey: null'), '#1067 exact attachment detach must remain');
}
console.log('production-apartment-news-image-monotonic-failure-cleanup-contract: PASS');
