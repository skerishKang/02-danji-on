import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EXPECTED_FRONTEND_HOST = 'danjion.pages.dev';
const COMPLEX_SLUG = 'bangnim-myeongji-roadhill';
const SUCCESS_COPY = '저장됐습니다. 최신 목록을 다시 불러옵니다.';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M/wn4GBgYGJAQoAHgQCAQ6qN3sAAAAASUVORK5CYII=',
  'base64',
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function exactOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== EXPECTED_FRONTEND_HOST || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PRODUCTION_FRONTEND_ORIGIN_INVALID');
  }
  return url.origin;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function report(name, value = 'PASS') {
  console.log(`${name}=${value}`);
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || 'UNKNOWN')
    .replace(/[^A-Za-z0-9_:/.-]/g, '_')
    .slice(0, 180);
}

const frontendBase = exactOrigin(required('DANJION_PRODUCTION_FRONTEND_URL'));
const email = required('DANJION_PRODUCTION_OPERATOR_EMAIL');
const password = required('DANJION_PRODUCTION_OPERATOR_PASSWORD');
if (password.length < 8) throw new Error('PRODUCTION_OPERATOR_PASSWORD_INVALID');

async function assertLiveParity(path, localUrl) {
  const response = await fetch(new URL(path, `${frontendBase}/`), {
    redirect: 'follow',
    headers: { accept: path.endsWith('.js') ? 'text/javascript,*/*' : 'text/html,*/*' },
  });
  if (response.status !== 200) throw new Error(`LIVE_PARITY_HTTP_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== EXPECTED_FRONTEND_HOST) {
    throw new Error('LIVE_PARITY_REDIRECT_TARGET_INVALID');
  }
  const live = Buffer.from(await response.arrayBuffer());
  const local = await readFile(localUrl);
  if (live.byteLength !== local.byteLength || sha256(live) !== sha256(local)) {
    throw new Error('LIVE_PARITY_SHA256_MISMATCH');
  }
}

let browser;
let context;
let page;
let stage = 'START';
let objectKey = '';
let postId = '';
let archived = false;
const apiEvents = [];

try {
  stage = 'LIVE_SOURCE_PARITY';
  await assertLiveParity('admin/index.html', new URL('../../../frontend/admin/index.html', import.meta.url));
  await assertLiveParity('assets/danjion-admin-console.js', new URL('../../../frontend/assets/danjion-admin-console.js', import.meta.url));
  await assertLiveParity('08A_아파트소식_상세.html', new URL('../../../frontend/08A_아파트소식_상세.html', import.meta.url));
  report('LIVE_ADMIN_INDEX_PARITY');
  report('LIVE_ADMIN_BRIDGE_PARITY');
  report('LIVE_08A_PARITY');

  stage = 'BROWSER';
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();

  stage = 'SIGN_IN';
  const signin = await context.request.post(`${frontendBase}/api/auth/sign-in/email`, {
    headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
    data: { email, password },
  });
  if (signin.status() !== 200) throw new Error(`SIGNIN_HTTP_${signin.status()}`);
  report('SIGN_IN');

  stage = 'SESSION';
  const session = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase },
  });
  if (session.status() !== 200) throw new Error(`SESSION_HTTP_${session.status()}`);
  const sessionJson = await session.json().catch(() => null);
  if (!sessionJson?.session || !sessionJson?.user) throw new Error('SESSION_NOT_AUTHENTICATED');
  report('SESSION');

  stage = 'ADMIN_LOAD';
  page = await context.newPage();
  page.on('response', (response) => {
    const request = response.request();
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method())) return;
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/storage/') || url.pathname.startsWith('/api/v1/admin/')) {
      apiEvents.push(`${request.method()}:${response.status()}:${url.pathname}`);
    }
  });

  await page.goto(new URL('admin/', `${frontendBase}/`).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  const postsTab = page.getByRole('button', { name: '단지소식', exact: true });
  await postsTab.waitFor({ state: 'visible', timeout: 20_000 });
  await postsTab.click();
  await page.getByText('새 단지소식 작성', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  report('PRODUCTION_ADMIN_POSTS_SURFACE');

  stage = 'COMPOSER_FILL';
  const suffix = Date.now().toString(36);
  const title = `Production #844 image E2E ${suffix}`;
  const body = `#844 Production bounded official-news image acceptance ${suffix}`;

  await page.getByLabel('출처').first().fill('입주자대표회의');
  await page.getByLabel('소식 채널').first().selectOption('apartment_news');
  await page.getByLabel('표시 방식').first().selectOption('article');
  await page.getByLabel('분류').first().fill('운영검증');
  await page.getByLabel('소식 제목').first().fill(title);
  await page.getByLabel('소식 본문').first().fill(body);
  await page.getByLabel('게시 상태').first().selectOption('published');

  const imageInput = page.getByLabel('공식소식 사진').first();
  await imageInput.setInputFiles({
    name: 'official-news-844.png',
    mimeType: 'image/png',
    buffer: PNG_BYTES,
  });
  const imageStatus = imageInput.locator('xpath=..').locator('.admin-post-status');
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="공식소식 사진"]');
    const box = input?.closest('.admin-post-image');
    return box?.textContent?.includes('선택됨 · 게시할 때 업로드') === true;
  });
  report('OFFICIAL_NEWS_PHOTO_SELECTED_LOCAL_ONLY');

  stage = 'SUBMIT';
  page.once('dialog', (dialog) => dialog.accept());
  const storageResponsePromise = page.waitForResponse((response) => {
    const u = new URL(response.url());
    return response.request().method() === 'POST' && u.pathname === '/api/v1/storage/objects';
  }, { timeout: 45_000 });
  const postResponsePromise = page.waitForResponse((response) => {
    const u = new URL(response.url());
    return response.request().method() === 'POST' &&
      u.pathname === `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`;
  }, { timeout: 45_000 });

  await page.getByRole('button', { name: '새 소식 저장', exact: true }).click();
  const [storageResponse, postResponse] = await Promise.all([storageResponsePromise, postResponsePromise]);

  if (storageResponse.status() !== 201) throw new Error(`STORAGE_UPLOAD_HTTP_${storageResponse.status()}`);
  const storageJson = await storageResponse.json().catch(() => null);
  objectKey = String(storageJson?.data?.objectKey || '');
  if (!/^gdrive\/public\/official-news-image\/[A-Za-z0-9_-]{10,200}$/.test(objectKey)) {
    throw new Error('OFFICIAL_NEWS_OBJECT_KEY_INVALID');
  }
  report('OFFICIAL_NEWS_R2_UPLOAD_201');
  report('SERVER_ISSUED_OBJECT_KEY');

  if (postResponse.status() !== 201) throw new Error(`OFFICIAL_POST_CREATE_HTTP_${postResponse.status()}`);
  const postJson = await postResponse.json().catch(() => null);
  postId = String(postJson?.data?.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(postId)) {
    throw new Error('OFFICIAL_POST_ID_INVALID');
  }
  if (String(postJson?.data?.display_mode || '') !== 'article') throw new Error('POST_CREATE_DISPLAY_MODE_NOT_ARTICLE');
  report('OFFICIAL_POST_CREATE_201');
  report('OFFICIAL_POST_DISPLAY_MODE_ARTICLE');

  stage = 'PUBLIC_READBACK';
  const postRead = await context.request.get(
    `${frontendBase}/api/v1/complexes/${COMPLEX_SLUG}/posts/${encodeURIComponent(postId)}`,
    { headers: { accept: 'application/json' } },
  );
  if (postRead.status() !== 200) throw new Error(`PUBLIC_POST_READ_HTTP_${postRead.status()}`);
  const postReadJson = await postRead.json().catch(() => null);
  const row = postReadJson?.data;
  if (!row || String(row.attachment_object_key || '') !== objectKey) throw new Error('PUBLIC_POST_ATTACHMENT_MISMATCH');
  if (String(row.channel || '') !== 'apartment_news') throw new Error('PUBLIC_POST_CHANNEL_MISMATCH');
  if (String(row.display_mode || '') !== 'article') throw new Error('PUBLIC_POST_DISPLAY_MODE_MISMATCH');
  if (String(row.title || '') !== title || String(row.body || '') !== body) throw new Error('PUBLIC_POST_CONTENT_MISMATCH');
  report('PUBLIC_POST_READBACK');
  report('PUBLIC_ATTACHMENT_REFERENCE_MATCH');

  stage = 'PUBLIC_IMAGE_READBACK';
  const imageRead = await context.request.get(
    `${frontendBase}/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (imageRead.status() !== 200) throw new Error(`PUBLIC_IMAGE_HTTP_${imageRead.status()}`);
  const imageBytes = Buffer.from(await imageRead.body());
  const contentType = String(imageRead.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (imageBytes.byteLength !== PNG_BYTES.byteLength) throw new Error('PUBLIC_IMAGE_LENGTH_MISMATCH');
  if (sha256(imageBytes) !== sha256(PNG_BYTES)) throw new Error('PUBLIC_IMAGE_SHA256_MISMATCH');
  if (contentType !== 'image/png') throw new Error('PUBLIC_IMAGE_CONTENT_TYPE_MISMATCH');
  report('PUBLIC_IMAGE_HTTP_200');
  report('PUBLIC_IMAGE_LENGTH_MATCH');
  report('PUBLIC_IMAGE_SHA256_MATCH');
  report('PUBLIC_IMAGE_CONTENT_TYPE_SAFE');

  stage = 'ARTICLE_BROWSER_RENDER';
  await page.goto(new URL(`08A_아파트소식_상세.html?post=${encodeURIComponent(postId)}`, `${frontendBase}/`).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  const articleImage = page.locator('#articleMedia img');
  await articleImage.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('#articleMedia img');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }, null, { timeout: 20_000 });
  if (!(await page.locator('#articleBody').innerText()).includes(body)) throw new Error('ARTICLE_BODY_NOT_RENDERED');
  report('ARTICLE_IMAGE_RENDERED');
  report('ARTICLE_IMAGE_DECODED');
  report('ARTICLE_TEXT_PRESERVED');

  stage = 'REFERENCED_DELETE_GUARD';
  const deleteProbe = await context.request.delete(
    `${frontendBase}/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`,
    { headers: { Origin: frontendBase } },
  );
  if (deleteProbe.status() !== 409) throw new Error(`REFERENCED_DELETE_HTTP_${deleteProbe.status()}`);
  report('REFERENCED_OBJECT_DELETE_GUARD_409');

  stage = 'ARCHIVE_FIXTURE';
  const archive = await context.request.patch(
    `${frontendBase}/api/v1/admin/posts/${encodeURIComponent(postId)}`,
    {
      headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
      data: { status: 'archived' },
    },
  );
  if (archive.status() !== 200) throw new Error(`ARCHIVE_HTTP_${archive.status()}`);
  archived = true;
  report('ACCEPTANCE_POST_ARCHIVED');

  stage = 'ARCHIVE_PUBLIC_FAIL_CLOSED';
  const archivedPost = await context.request.get(
    `${frontendBase}/api/v1/complexes/${COMPLEX_SLUG}/posts/${encodeURIComponent(postId)}`,
    { headers: { accept: 'application/json' } },
  );
  if (archivedPost.status() !== 404) throw new Error(`ARCHIVED_POST_PUBLIC_HTTP_${archivedPost.status()}`);
  const archivedImage = await context.request.get(
    `${frontendBase}/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (archivedImage.status() !== 404) throw new Error(`ARCHIVED_IMAGE_PUBLIC_HTTP_${archivedImage.status()}`);
  report('ARCHIVED_POST_PUBLIC_404');
  report('ARCHIVED_IMAGE_PUBLIC_404');

  report('PRODUCTION_844_APARTMENT_NEWS_IMAGE_ACCEPTANCE');
  console.log('PRODUCT_DATA_MUTATION_SCOPE=official_news_image_upload_1+official_post_create_1+official_post_archive_1');
  console.log('REFERENCED_DELETE_PROBE=1_EXPECTED_409');
  console.log('DB_SCHEMA_MUTATION=0');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('HOUSEHOLD_PROVISIONING=0');
  console.log('AUTO_RETRY_FOR_MUTATIONS=0');
  console.log('SECRET_OUTPUT=0');
} catch (error) {
  console.error(`PRODUCTION_844_ACCEPTANCE_FAILED=${stage}:${safeError(error)}`);
  if (apiEvents.length) console.log(`DIAG_MUTATION_RESPONSES=${apiEvents.join(' | ')}`);

  // One bounded failure cleanup attempt is allowed, never retried.
  if (context && postId && !archived) {
    const cleanup = await context.request.patch(
      `${frontendBase}/api/v1/admin/posts/${encodeURIComponent(postId)}`,
      {
        headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
        data: { status: 'archived' },
      },
    ).catch(() => null);
    console.log(`FAILURE_POST_ARCHIVE_CLEANUP=${cleanup?.status() === 200 ? 'PASS' : 'FAILED'}`);
  } else if (context && objectKey && !postId) {
    const cleanup = await context.request.delete(
      `${frontendBase}/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`,
      { headers: { Origin: frontendBase } },
    ).catch(() => null);
    console.log(`FAILURE_UNREFERENCED_OBJECT_CLEANUP=${cleanup && [200, 404].includes(cleanup.status()) ? 'PASS' : 'FAILED'}`);
  }
  process.exitCode = 1;
} finally {
  if (context) {
    await context.request.post(`${frontendBase}/api/auth/sign-out`, {
      headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
      data: {},
    }).catch(() => null);
    await context.close().catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
}
