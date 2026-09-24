import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EXPECTED_HOST = 'danjion.pages.dev';
const COMPLEX_SLUG = 'banglim-myeongji-roadhill';
const OBJECT_KEY_RE = /^gdrive\/public\/official-news-image\/[A-Za-z0-9_-]{10,200}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function exactOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== EXPECTED_HOST || url.pathname !== '/' || url.search || url.hash) {
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

function safeCode(value) {
  return String(value || 'UNKNOWN').replace(/[^A-Za-z0-9_:/.-]/g, '_').slice(0, 180);
}

async function jsonEnvelope(response) {
  return response.json().catch(() => null);
}

async function liveByteParity(base, livePath, localUrl, marker) {
  const response = await fetch(new URL(livePath, `${base}/`), {
    redirect: 'follow',
    headers: { accept: livePath.endsWith('.js') ? 'application/javascript' : 'text/html' },
  });
  if (response.status !== 200) throw new Error(`${marker}_HTTP_${response.status}`);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== EXPECTED_HOST) {
    throw new Error(`${marker}_REDIRECT_TARGET_INVALID`);
  }
  const live = Buffer.from(await response.arrayBuffer());
  const local = await readFile(localUrl);
  if (live.byteLength !== local.byteLength || sha256(live) !== sha256(local)) {
    throw new Error(`${marker}_BYTE_PARITY_MISMATCH`);
  }
  report(marker);
}

const frontendBase = exactOrigin(required('DANJION_PRODUCTION_FRONTEND_URL'));
const email = required('DANJION_PRODUCTION_OPERATOR_EMAIL');
const password = required('DANJION_PRODUCTION_OPERATOR_PASSWORD');
const unauthorizedEmail = required('DANJION_PRODUCTION_25A_EMAIL');
const unauthorizedPassword = required('DANJION_PRODUCTION_25A_PASSWORD');
if (password.length < 8) throw new Error('PRODUCTION_OPERATOR_PASSWORD_INVALID');
if (unauthorizedPassword.length < 8) throw new Error('PRODUCTION_25A_PASSWORD_INVALID');
if (unauthorizedEmail.toLowerCase() === email.toLowerCase()) throw new Error('PRODUCTION_UNAUTHORIZED_PRINCIPAL_COLLISION');

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nT8AAAAASUVORK5CYII=',
  'base64',
);
const expectedImageSha = sha256(pngBytes);
const filePayload = { name: 'apartment-news-844.png', mimeType: 'image/png', buffer: pngBytes };

let browser;
let context;
let unauthorizedContext;
let articlePage;
let stage = 'START';
let mutationStarted = false;

try {
  stage = 'LIVE_SOURCE_PARITY';
  await liveByteParity(
    frontendBase,
    'admin/index.html',
    new URL('../../../frontend/admin/index.html', import.meta.url),
    'LIVE_ADMIN_SOURCE_BYTE_PARITY',
  );
  await liveByteParity(
    frontendBase,
    '08A_아파트소식_상세.html',
    new URL('../../../frontend/08A_아파트소식_상세.html', import.meta.url),
    'LIVE_08A_SOURCE_BYTE_PARITY',
  );
  await liveByteParity(
    frontendBase,
    'assets/danjion-news-bridge.js',
    new URL('../../../frontend/assets/danjion-news-bridge.js', import.meta.url),
    'LIVE_NEWS_BRIDGE_BYTE_PARITY',
  );

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();

  // Signed-out requests exercise the same Production endpoints but must fail before mutation.
  stage = 'SIGNED_OUT_FAIL_CLOSED';
  const signedOutUpload = await context.request.post(`${frontendBase}/api/v1/storage/objects`, {
    multipart: {
      kind: 'official-news-image',
      complexSlug: COMPLEX_SLUG,
      file: filePayload,
    },
  });
  if (signedOutUpload.status() !== 401) throw new Error(`SIGNED_OUT_UPLOAD_HTTP_${signedOutUpload.status()}`);
  const signedOutPost = await context.request.post(
    `${frontendBase}/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`,
    {
      data: {
        sourceName: '입주자대표회의',
        category: '현장기록',
        title: 'signed-out probe',
        body: 'must never persist',
        channel: 'apartment_news',
        displayMode: 'article',
        status: 'published',
      },
    },
  );
  if (signedOutPost.status() !== 401) throw new Error(`SIGNED_OUT_POST_HTTP_${signedOutPost.status()}`);
  report('SIGNED_OUT_UPLOAD_DENIED_401');
  report('SIGNED_OUT_POST_DENIED_401');

  stage = 'UNAUTHORIZED_FAIL_CLOSED';
  unauthorizedContext = await browser.newContext();
  const unauthorizedSignin = await unauthorizedContext.request.post(`${frontendBase}/api/auth/sign-in/email`, {
    headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
    data: { email: unauthorizedEmail, password: unauthorizedPassword },
  });
  if (unauthorizedSignin.status() !== 200) throw new Error(`UNAUTHORIZED_SIGNIN_HTTP_${unauthorizedSignin.status()}`);
  const unauthorizedSession = await unauthorizedContext.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase },
  });
  if (unauthorizedSession.status() !== 200) throw new Error(`UNAUTHORIZED_SESSION_HTTP_${unauthorizedSession.status()}`);
  const unauthorizedSessionJson = await unauthorizedSession.json().catch(() => null);
  if (!unauthorizedSessionJson?.session || !unauthorizedSessionJson?.user) throw new Error('UNAUTHORIZED_SESSION_NOT_AUTHENTICATED');

  // Deliberately invalid body: createPost() must return 403 at authority() before validation.
  // If authorization regresses open, validation returns 400 instead, still creating no data.
  const unauthorizedWrite = await unauthorizedContext.request.post(
    `${frontendBase}/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`,
    { data: {} },
  );
  if (unauthorizedWrite.status() !== 403) throw new Error(`UNAUTHORIZED_WRITE_HTTP_${unauthorizedWrite.status()}`);
  report('UNAUTHORIZED_WRITE_DENIED');
  report('TEST_RESIDENT_OFFICIAL_WRITE_DENIED');
  await unauthorizedContext.close();
  unauthorizedContext = null;

  stage = 'SIGN_IN';
  const signin = await context.request.post(`${frontendBase}/api/auth/sign-in/email`, {
    headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
    data: { email, password },
  });
  if (signin.status() !== 200) throw new Error(`SIGNIN_HTTP_${signin.status()}`);
  report('SIGN_IN');
  report('TEST_OPERATIONAL_SIGNIN');

  const session = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase },
  });
  if (session.status() !== 200) throw new Error(`SESSION_HTTP_${session.status()}`);
  const sessionJson = await session.json().catch(() => null);
  if (!sessionJson?.session || !sessionJson?.user) throw new Error('SESSION_NOT_AUTHENTICATED');
  report('SESSION');

  stage = 'AUTHORITY';
  const authority = await context.request.get(`${frontendBase}/api/v1/admin/authority`);
  if (authority.status() !== 200) throw new Error(`AUTHORITY_HTTP_${authority.status()}`);
  const authorityJson = await jsonEnvelope(authority);
  const authorityData = authorityJson?.data;
  const scopes = Array.isArray(authorityData?.scopes) ? authorityData.scopes : [];
  const authorized = authorityData?.wildcard === true || scopes.includes('official-content.manage');
  if (!authorized) throw new Error('OFFICIAL_CONTENT_AUTHORITY_MISSING');
  report('OFFICIAL_CONTENT_AUTHORITY');
  report('TEST_OPERATIONAL_OFFICIAL_CONTENT_AUTHORITY');

  stage = 'ADMIN_UI';
  const page = await context.newPage();
  await page.goto(`${frontendBase}/admin/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByRole('button', { name: '단지소식', exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: '단지소식', exact: true }).click();
  const composer = page.locator('section.admin-post-editor.create');
  await composer.getByRole('heading', { name: '새 단지소식 작성', exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
  report('PRODUCTION_ADMIN_POST_COMPOSER_VISIBLE');

  const suffix = Date.now().toString(36);
  const title = `#844 Production image E2E ${suffix}`;
  const body = `#844 bounded Production acceptance ${suffix}\n이미지 게시·공개 렌더·텍스트 전용 회귀를 확인합니다.`;

  stage = 'ADMIN_UI_SOURCE';
  await composer.getByLabel('출처', { exact: true }).fill('입주자대표회의');
  stage = 'ADMIN_UI_CATEGORY';
  await composer.getByLabel('분류', { exact: true }).fill('현장기록');
  stage = 'ADMIN_UI_TITLE';
  await composer.getByLabel('소식 제목', { exact: true }).fill(title);
  stage = 'ADMIN_UI_BODY';
  await composer.getByLabel('소식 본문', { exact: true }).fill(body);
  await composer.getByLabel('공식 채널', { exact: true }).selectOption('apartment_news');
  await composer.getByLabel('표시 방식', { exact: true }).selectOption('article');
  await composer.getByLabel('게시 상태', { exact: true }).selectOption('published');
  await composer.getByLabel('대표 사진', { exact: true }).setInputFiles(filePayload);
  await composer.getByText('선택됨 · 게시할 때 업로드됩니다.', { exact: true }).waitFor({ state: 'visible' });
  report('OFFICIAL_NEWS_PHOTO_PICKER');
  report('ARTICLE_MODE_SELECTED');

  let releasePost;
  let postInterceptedResolve;
  const postIntercepted = new Promise((resolve) => { postInterceptedResolve = resolve; });
  const releasePostGate = new Promise((resolve) => { releasePost = resolve; });
  await page.route(
    (url) => url.pathname === `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      postInterceptedResolve();
      await releasePostGate;
      await route.continue();
    },
  );

  const storageResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/storage/objects',
    { timeout: 30_000 },
  );
  const postResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`,
    { timeout: 30_000 },
  );

  page.once('dialog', (dialog) => dialog.accept());
  mutationStarted = true;
  await composer.getByRole('button', { name: '새 소식 저장', exact: true }).click();

  stage = 'UPLOAD';
  const storageResponse = await storageResponsePromise;
  if (storageResponse.status() !== 201) throw new Error(`OFFICIAL_NEWS_UPLOAD_HTTP_${storageResponse.status()}`);
  const storageJson = await storageResponse.json().catch(() => null);
  const objectKey = String(storageJson?.data?.objectKey || '');
  if (!OBJECT_KEY_RE.test(objectKey)) throw new Error('OFFICIAL_NEWS_OBJECT_KEY_INVALID');
  report('OFFICIAL_NEWS_UPLOAD_201');
  report('SERVER_ISSUED_OBJECT_KEY');
  console.log('OBJECT_KIND=official-news-image');

  await postIntercepted;
  const unpublishedRead = await context.request.get(
    `${frontendBase}/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (unpublishedRead.status() !== 404) throw new Error(`UNREFERENCED_PUBLIC_IMAGE_HTTP_${unpublishedRead.status()}`);
  report('UNREFERENCED_PUBLIC_IMAGE_DENIED_404');
  releasePost();

  stage = 'POST_CREATE';
  const postResponse = await postResponsePromise;
  if (postResponse.status() !== 201) throw new Error(`OFFICIAL_POST_CREATE_HTTP_${postResponse.status()}`);
  const postJson = await postResponse.json().catch(() => null);
  const postId = String(postJson?.data?.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new Error('OFFICIAL_POST_ID_INVALID');
  if (String(postJson?.data?.channel || '') !== 'apartment_news') throw new Error('OFFICIAL_POST_CHANNEL_MISMATCH');
  if (String(postJson?.data?.display_mode || '') !== 'article') throw new Error('OFFICIAL_POST_DISPLAY_MODE_MISMATCH');
  report('OFFICIAL_POST_CREATE_201');
  report('POST_DISPLAY_MODE_ARTICLE');

  stage = 'PUBLIC_READBACK';
  const publicPost = await context.request.get(
    `${frontendBase}/api/v1/complexes/${COMPLEX_SLUG}/posts/${postId}`,
  );
  if (publicPost.status() !== 200) throw new Error(`PUBLIC_POST_HTTP_${publicPost.status()}`);
  const publicPostJson = await publicPost.json().catch(() => null);
  const postData = publicPostJson?.data;
  if (String(postData?.id || '') !== postId ||
      String(postData?.channel || '') !== 'apartment_news' ||
      String(postData?.display_mode || '') !== 'article' ||
      String(postData?.attachment_object_key || '') !== objectKey ||
      String(postData?.title || '') !== title) {
    throw new Error('PUBLIC_POST_READBACK_MISMATCH');
  }
  report('PUBLIC_POST_ATTACHMENT_READBACK');

  const imageRead = await context.request.get(
    `${frontendBase}/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (imageRead.status() !== 200) throw new Error(`PUBLIC_IMAGE_HTTP_${imageRead.status()}`);
  const imageBytes = Buffer.from(await imageRead.body());
  if (imageBytes.byteLength !== pngBytes.byteLength) throw new Error('PUBLIC_IMAGE_BYTE_LENGTH_MISMATCH');
  if (sha256(imageBytes) !== expectedImageSha) throw new Error('PUBLIC_IMAGE_SHA256_MISMATCH');
  if (!String(imageRead.headers()['content-type'] || '').toLowerCase().startsWith('image/png')) {
    throw new Error('PUBLIC_IMAGE_CONTENT_TYPE_MISMATCH');
  }
  report('PUBLIC_IMAGE_HTTP_200');
  report('PUBLIC_IMAGE_BYTE_LENGTH_MATCH');
  report('PUBLIC_IMAGE_SHA256_MATCH');
  report('PUBLIC_IMAGE_CONTENT_TYPE_SAFE');
  // Pre-dispatch CENTRAL verification pins this exact main to the Production R2 runtime;
  // exact public-byte readback therefore proves the uploaded object exists in that R2 runtime.
  report('R2_OBJECT_EXISTS');

  stage = 'ARTICLE_BROWSER_IMAGE';
  articlePage = await context.newPage();
  await articlePage.goto(
    `${frontendBase}/08A_아파트소식_상세.html?post=${encodeURIComponent(postId)}`,
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
  );
  await articlePage.locator('#articleTitle').filter({ hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
  await articlePage.locator('#articleBody').filter({ hasText: '#844 bounded Production acceptance' }).waitFor({ state: 'visible' });
  const image = articlePage.locator('#articleMedia img');
  await image.waitFor({ state: 'visible', timeout: 20_000 });
  await articlePage.waitForFunction(() => {
    const img = document.querySelector('#articleMedia img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 20_000 });
  const rendered = await articlePage.evaluate(() => {
    const img = document.querySelector('#articleMedia img');
    const article = document.querySelector('main article');
    if (!(img instanceof HTMLImageElement) || !(article instanceof HTMLElement)) return null;
    const ir = img.getBoundingClientRect();
    const ar = article.getBoundingClientRect();
    return {
      src: img.currentSrc || img.src,
      mediaHidden: document.getElementById('articleMedia')?.hidden === true,
      imageWidth: ir.width,
      articleWidth: ar.width,
      bodyText: document.getElementById('articleBody')?.textContent || '',
    };
  });
  if (!rendered || rendered.mediaHidden || rendered.imageWidth <= 0 ||
      rendered.imageWidth > rendered.articleWidth + 1 ||
      !rendered.src.includes('/api/v1/storage/public?objectKey=') ||
      !rendered.bodyText.includes('#844 bounded Production acceptance')) {
    throw new Error('ARTICLE_IMAGE_RENDER_MISMATCH');
  }
  report('ARTICLE_IMAGE_RENDERED');
  report('ARTICLE_IMAGE_RESPONSIVE');
  report('ARTICLE_TEXT_PRESERVED');

  // Detach while keeping the same published article, then prove text-only browser behavior.
  stage = 'TEXT_ONLY_REGRESSION';
  const detach = await context.request.patch(`${frontendBase}/api/v1/admin/posts/${postId}`, {
    data: {
      attachmentObjectKey: null,
      channel: 'apartment_news',
      displayMode: 'article',
      status: 'published',
    },
  });
  if (detach.status() !== 200) throw new Error(`DETACH_HTTP_${detach.status()}`);
  const detachedPost = await context.request.get(
    `${frontendBase}/api/v1/complexes/${COMPLEX_SLUG}/posts/${postId}`,
  );
  if (detachedPost.status() !== 200) throw new Error(`DETACHED_PUBLIC_POST_HTTP_${detachedPost.status()}`);
  const detachedJson = await detachedPost.json().catch(() => null);
  if (detachedJson?.data?.attachment_object_key != null) throw new Error('DETACHED_PUBLIC_POST_STILL_REFERENCED');

  await articlePage.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  await articlePage.locator('#articleTitle').filter({ hasText: title }).waitFor({ state: 'visible', timeout: 20_000 });
  const textOnly = await articlePage.evaluate(() => ({
    mediaHidden: document.getElementById('articleMedia')?.hidden === true,
    mediaChildren: document.querySelectorAll('#articleMedia img').length,
    bodyText: document.getElementById('articleBody')?.textContent || '',
  }));
  if (!textOnly.mediaHidden || textOnly.mediaChildren !== 0 ||
      !textOnly.bodyText.includes('#844 bounded Production acceptance')) {
    throw new Error('TEXT_ONLY_ARTICLE_REGRESSION');
  }
  report('NO_ATTACHMENT_TEXT_ONLY_REGRESSION');

  const detachedImageRead = await context.request.get(
    `${frontendBase}/api/v1/storage/public?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (detachedImageRead.status() !== 404) throw new Error(`DETACHED_IMAGE_PUBLIC_HTTP_${detachedImageRead.status()}`);
  report('DETACHED_IMAGE_PUBLIC_DENIED_404');

  stage = 'CLEANUP';
  const deleteObject = await context.request.delete(
    `${frontendBase}/api/v1/storage/objects?objectKey=${encodeURIComponent(objectKey)}`,
  );
  if (deleteObject.status() !== 200) throw new Error(`OFFICIAL_NEWS_DELETE_HTTP_${deleteObject.status()}`);
  report('OFFICIAL_NEWS_IMAGE_RETIRED');
  console.log('RETENTION_DISPOSITION=DETACH_THEN_RETIRE');

  const archive = await context.request.patch(`${frontendBase}/api/v1/admin/posts/${postId}`, {
    data: {
      channel: 'apartment_news',
      displayMode: 'article',
      status: 'archived',
    },
  });
  if (archive.status() !== 200) throw new Error(`ARCHIVE_HTTP_${archive.status()}`);
  const afterArchive = await context.request.get(
    `${frontendBase}/api/v1/complexes/${COMPLEX_SLUG}/posts/${postId}`,
  );
  if (afterArchive.status() !== 404) throw new Error(`ARCHIVED_PUBLIC_POST_HTTP_${afterArchive.status()}`);
  report('ACCEPTANCE_POST_ARCHIVED');
  report('PUBLIC_POST_REMOVED_AFTER_ARCHIVE');

  await context.request.post(`${frontendBase}/api/auth/sign-out`, {
    headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
    data: {},
  }).catch(() => null);

  report('PRODUCTION_844_APARTMENT_NEWS_IMAGE_ACCEPTANCE');
  console.log('PRODUCTION_PRODUCT_DATA_MUTATION_SCOPE=official_news_image_upload_1+official_post_create_1+attachment_detach_1+image_retire_1+post_archive_1');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('HOUSEHOLD_PROVISIONING=0');
  console.log('AUTO_RETRY_FOR_MUTATIONS=0');
  console.log('SECRET_OUTPUT=0');
} catch (error) {
  const code = safeCode(error instanceof Error ? error.message : error);
  console.error(`PRODUCTION_844_ACCEPTANCE_FAILED=${stage}:${code}`);
  console.log(`PRODUCTION_MUTATION_STARTED=${mutationStarted ? 'YES' : 'NO'}`);
  console.log('AUTO_RETRY_FOR_MUTATIONS=0');
  console.log('SECRET_OUTPUT=0');
  process.exitCode = 1;
} finally {
  if (articlePage) await articlePage.close().catch(() => {});
  if (unauthorizedContext) await unauthorizedContext.close().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
