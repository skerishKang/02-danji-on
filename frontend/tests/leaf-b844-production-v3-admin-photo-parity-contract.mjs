import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const [pagesRelease, admin, adminConsole] = await Promise.all([
  readFile(new URL('.github/workflows/pages-production-release.yml', root), 'utf8'),
  readFile(new URL('frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('frontend/assets/danjion-admin-console.js', root), 'utf8')
]);

// Canonical Production Pages deploys top-level frontend/, not the V2 React tree.
assert.ok(pagesRelease.includes('cp -R frontend/. dist/'),
  'Production Pages must keep top-level frontend/ as the canonical artifact');
assert.ok(pagesRelease.includes('Current public origin: `https://danjion.pages.dev`') ||
  pagesRelease.includes('CURRENT_PUBLIC_ORIGIN: https://danjion.pages.dev'));

// #844 Production V3 parity: the canonical admin surface must expose the real photo lane.
for (const needle of [
  "OFFICIAL_NEWS_IMAGE_KEY=/^gdrive\\/public\\/official-news-image",
  "OFFICIAL_NEWS_IMAGE_MAX_BYTES=8*1024*1024",
  "new Set(['image/jpeg','image/png','image/webp'])",
  "input.setAttribute('aria-label','공식소식 사진')",
  "input.accept='image/jpeg,image/png,image/webp'",
  "function uploadOfficialNewsImage(apiBase,image)",
  "body.set('kind','official-news-image')",
  "body.set('complexSlug',consoleApi.COMPLEX_SLUG)",
  "credentials:'include'",
  "'idempotency-key':image.idempotencyKey",
  "function deleteOfficialNewsImage(apiBase,objectKey)",
  "function preparePostAttachment(apiBase,fields,live)",
  "PHOTO"
]) {
  if (needle === 'PHOTO') continue;
  assert.ok(admin.includes(needle), `canonical admin missing #844 contract: ${needle}`);
}

// Selection stays local; upload occurs only through submit preparation.
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
assert.ok(prepareBlock.includes('uploadOfficialNewsImage(apiBase,image)'),
  'submit preparation must own the official-news upload');
assert.ok(prepareBlock.includes('if(image.uploadedKey)return image.uploadedKey'),
  'failed post retries must reuse the already-uploaded object');

// Canonical V3 composer must send explicit channel + server-issued attachment key.
for (const needle of [
  "OFFICIAL_POST_CHANNELS=['danjion_notice','apartment_news','management_office','chair_greeting']",
  "select.setAttribute('aria-label','소식 채널')",
  "channel:fields.channel.value",
  "attachmentObjectKey",
  "postFields({status:'draft',channel:'apartment_news',source_name:'입주자대표회의'}",
  "isPhotoChannel(value){return value==='apartment_news'||value==='management_office'}"
]) assert.ok(admin.includes(needle), `canonical composer missing: ${needle}`);

// Canonical admin API bridge must not strip the two #844 fields anymore.
for (const needle of [
  "const POST_CHANNELS = Object.freeze(['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'])",
  "const channel = String(value.channel || '').trim()",
  "Object.prototype.hasOwnProperty.call(value, 'attachmentObjectKey')",
  "...(channel ? { channel } : {})",
  "...(hasAttachment ? { attachmentObjectKey } : {})"
]) assert.ok(adminConsole.includes(needle), `admin bridge missing: ${needle}`);

// No object key may be rendered to operators as user-facing text.
assert.equal(admin.includes("status.textContent=image.uploadedKey"), false);
assert.equal(admin.includes("textContent=objectKey"), false);

console.log('CANONICAL_PRODUCTION_ADMIN_SOURCE=frontend/admin/index.html');
console.log('OFFICIAL_NEWS_PHOTO_PICKER=PASS');
console.log('OFFICIAL_NEWS_UPLOAD_ON_SUBMIT_ONLY=PASS');
console.log('OFFICIAL_NEWS_CHANNEL_EXPLICIT=PASS');
console.log('OFFICIAL_NEWS_ATTACHMENT_PAYLOAD_PRESERVED=PASS');
console.log('leaf-b844-production-v3-admin-photo-parity-contract: PASS');
