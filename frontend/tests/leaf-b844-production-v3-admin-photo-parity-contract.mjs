import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const [pagesRelease, admin, adminConsole, storageBridge] = await Promise.all([
  readFile(new URL('.github/workflows/pages-production-release.yml', root), 'utf8'),
  readFile(new URL('frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-admin-official-news-storage.js', root), 'utf8')
]);

assert.ok(pagesRelease.includes('cp -R frontend/. dist/'),
  'Production Pages must keep top-level frontend/ as the canonical artifact');
assert.ok(admin.includes('/assets/danjion-admin-official-news-storage.js'),
  'canonical admin must load the dedicated official-news storage bridge');
assert.ok(admin.includes('window.DanjionAdminOfficialNewsStorage'),
  'canonical admin must bind the dedicated storage bridge');

for (const needle of [
  "input.setAttribute('aria-label','공식소식 사진')",
  "input.accept='image/jpeg,image/png,image/webp'",
  "officialNewsStorage.validateFile(file)",
  "officialNewsStorage.uploadOfficialNewsImage(fetch,apiBase,image.file,image.idempotencyKey,consoleApi.COMPLEX_SLUG)",
  "officialNewsStorage.deleteOfficialNewsImage(fetch,apiBase,image.uploadedKey)",
  "function preparePostAttachment(apiBase,fields,live)"
]) assert.ok(admin.includes(needle), 'canonical admin missing #844 contract: ' + needle);

for (const needle of [
  "OFFICIAL_NEWS_IMAGE_KEY = /^gdrive\\/public\\/official-news-image",
  "const MAX_BYTES = 8 * 1024 * 1024",
  "Object.freeze(['image/jpeg', 'image/png', 'image/webp'])",
  "body.set('kind', 'official-news-image')",
  "body.set('complexSlug', slug)",
  "credentials: 'include'",
  "'idempotency-key': key",
  "method: 'POST'",
  "method: 'DELETE'"
]) assert.ok(storageBridge.includes(needle), 'storage bridge missing: ' + needle);

const changeStart = admin.indexOf("input.addEventListener('change',async()=>");
const removeStart = admin.indexOf("remove.addEventListener('click',async()=>", changeStart);
assert.ok(changeStart > 0 && removeStart > changeStart);
const selectBlock = admin.slice(changeStart, removeStart);
assert.equal(selectBlock.includes('uploadOfficialNewsImage('), false,
  'selecting an image must not create a Production object');
assert.ok(selectBlock.includes('URL.createObjectURL(file)'),
  'selection must use a local preview before submit');

const prepareStart = admin.indexOf('async function preparePostAttachment(');
const cleanupStart = admin.indexOf('async function cleanupReplacedPostImage(', prepareStart);
const prepareBlock = admin.slice(prepareStart, cleanupStart);
assert.ok(prepareBlock.includes('officialNewsStorage.uploadOfficialNewsImage('),
  'submit preparation must own the official-news upload');
assert.ok(prepareBlock.includes('else if(image.uploadedKey)key=image.uploadedKey'),
  'failed post retries must reuse the already-uploaded object');

for (const needle of [
  "OFFICIAL_POST_CHANNELS=['danjion_notice','apartment_news','management_office','chair_greeting']",
  "select.setAttribute('aria-label','소식 채널')",
  "select.setAttribute('aria-label','표시 방식')",
  "['highlight','목록 강조'],['article','상세 글']",
  "const payload={sourceName:fields.source.value,category:fields.category.value,title:fields.title.value,body:fields.body.value,status:fields.status.value}",
  "if(channelChanged||displayModeChanged||attachmentChanged)payload.channel=fields.channel.value",
  "if(displayModeChanged)payload.displayMode=fields.displayMode.value",
  "if(attachmentChanged)payload.attachmentObjectKey=image.removeExisting?null:(image.preparedKey??image.uploadedKey??null)",
  "postFields({status:'draft',channel:'apartment_news',display_mode:'highlight',source_name:'입주자대표회의'}",
  "isPhotoChannel(value){return value==='apartment_news'||value==='management_office'}",
  "createOfficialPost(fetch,apiBase,postPayload(fields))",
  "updateOfficialPost(fetch,apiBase,row.id,postPayload(fields))"
]) assert.ok(admin.includes(needle), 'canonical composer missing: ' + needle);

for (const needle of [
  "const POST_CHANNELS = Object.freeze(['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'])",
  "const POST_DISPLAY_MODES = Object.freeze(['highlight', 'article'])",
  "Object.prototype.hasOwnProperty.call(value, 'displayMode')",
  "Object.prototype.hasOwnProperty.call(value, 'attachmentObjectKey')",
  "...(channel ? { channel } : {})",
  "...(hasDisplayMode ? { displayMode } : {})",
  "...(hasAttachment ? { attachmentObjectKey } : {})"
]) assert.ok(adminConsole.includes(needle), 'admin bridge missing: ' + needle);

assert.equal(/method\s*:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/.test(admin), false,
  'canonical admin page must delegate mutation transports to reviewed bridges');
assert.equal(admin.includes('object_key'), false,
  'canonical admin page must preserve the resident-news no-raw-private-object-key invariant');
assert.equal(admin.includes("status.textContent=image.uploadedKey"), false);
assert.equal(admin.includes("textContent=objectKey"), false);

// Legacy no-photo/no-mode-change submissions must stay byte-contract compatible
// with #609: the new fields are only emitted when the operator actually opts in.
assert.ok(admin.includes("const attachmentChanged=image.removeExisting||!!image.file||!!image.uploadedKey"));
assert.ok(admin.includes("const channelChanged=fields.channel.value!==fields.originalChannel"));
assert.ok(admin.includes("const displayModeChanged=fields.displayMode.value!==fields.originalDisplayMode"));
assert.equal(admin.includes("return {sourceName:fields.source.value,category:fields.category.value,title:fields.title.value,body:fields.body.value,status:fields.status.value,channel:"), false,
  'legacy composer must not unconditionally append #844 fields');

console.log('CANONICAL_PRODUCTION_ADMIN_SOURCE=frontend/admin/index.html');
console.log('OFFICIAL_NEWS_PHOTO_PICKER=PASS');
console.log('OFFICIAL_NEWS_UPLOAD_ON_SUBMIT_ONLY=PASS');
console.log('OFFICIAL_NEWS_STORAGE_BRIDGE=PASS');
console.log('OFFICIAL_NEWS_CHANNEL_EXPLICIT=PASS');
console.log('OFFICIAL_NEWS_ATTACHMENT_PAYLOAD_PRESERVED=PASS');
console.log('OFFICIAL_NEWS_DISPLAY_MODE_EXPLICIT=PASS');
console.log('LEGACY_NO_PHOTO_PAYLOAD_COMPAT=PASS');
console.log('leaf-b844-production-v3-admin-photo-parity-contract: PASS');
