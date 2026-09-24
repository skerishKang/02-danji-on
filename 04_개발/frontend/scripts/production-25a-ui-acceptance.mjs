import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EXPECTED_FRONTEND_HOST = 'danjion.pages.dev';
const LIVE_PAGE = '25A_신청제보.html';
const SUCCESS_COPY = '신청과 확인서류가 접수됐습니다. 검토 후 승인 상태를 내정보에서 확인할 수 있습니다.';
const GENERIC_PHOTO_FAILURE = '사진 업로드에 실패했습니다.';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function exactHttpsOrigin(value, expectedHost, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label}_ORIGIN_INVALID`);
  }
  return url.origin;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function report(name, value = 'PASS') {
  console.log(`${name}=${value}`);
}

function sanitizeCode(value) {
  return String(value || 'UNKNOWN_FAILURE').replace(/[^A-Za-z0-9_:/.-]/g, '_').slice(0, 180);
}

const frontendBase = exactHttpsOrigin(
  required('DANJION_PRODUCTION_FRONTEND_URL'),
  EXPECTED_FRONTEND_HOST,
  'PRODUCTION_FRONTEND',
);
const email = required('DANJION_PRODUCTION_25A_EMAIL');
const password = required('DANJION_PRODUCTION_25A_PASSWORD');
if (password.length < 8) throw new Error('PRODUCTION_25A_PASSWORD_INVALID');

let browser;
let page;
let context;
let stage = 'START';
const apiEvents = [];

try {
  stage = 'LIVE_SOURCE_PARITY';
  const liveResponse = await fetch(new URL(LIVE_PAGE, `${frontendBase}/`), {
    redirect: 'manual',
    headers: { accept: 'text/html' },
  });
  if (liveResponse.status !== 200) throw new Error(`LIVE_PAGE_HTTP_${liveResponse.status}`);
  const liveBytes = Buffer.from(await liveResponse.arrayBuffer());
  const localBytes = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url));
  if (liveBytes.byteLength !== localBytes.byteLength || sha256(liveBytes) !== sha256(localBytes)) {
    throw new Error('LIVE_SOURCE_BYTE_PARITY_MISMATCH');
  }
  report('LIVE_SOURCE_BYTE_PARITY');

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

  page = await context.newPage();
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() !== 'POST') return;
    const url = new URL(response.url());
    if (url.pathname === '/api/v1/storage/objects' || url.pathname === '/api/v1/me/business-applications') {
      apiEvents.push({ path: url.pathname, status: response.status() });
    }
  });

  stage = 'PAGE25A_LOAD';
  await page.goto(new URL(LIVE_PAGE, `${frontendBase}/`).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForSelector('#requestForm.mode-owner', { state: 'attached', timeout: 20_000 });
  report('PAGE25A_LOAD');

  const png = (name, marker) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`DANJION-809-${marker}`),
      Buffer.alloc(48),
    ]),
  });

  async function photoState(expectedText, disabled) {
    await page.waitForFunction(
      ({ expectedText, disabled }) => {
        const status = document.getElementById('photoStatus');
        const add = document.querySelector('[data-file-add="photos"]');
        return status?.textContent?.trim() === expectedText && Boolean(add?.disabled) === disabled;
      },
      { expectedText, disabled },
      { timeout: 10_000 },
    );
  }

  stage = 'PHOTO_ACCUMULATE_1';
  await page.locator('#photos').setInputFiles(png('shop-1.png', 'P1'));
  await photoState('1 / 3장', false);
  if (!(await page.locator('[data-file-add="photos"]').isVisible())) throw new Error('PHOTO_ADD_HIDDEN_AFTER_1');
  report('PHOTO_ADD_AFTER_1');

  stage = 'PHOTO_ACCUMULATE_2';
  await page.locator('#photos').setInputFiles(png('shop-2.png', 'P2'));
  await photoState('2 / 3장', false);
  report('PHOTO_ADD_AFTER_2');

  stage = 'PHOTO_ACCUMULATE_3';
  await page.locator('#photos').setInputFiles(png('shop-3.png', 'P3'));
  await photoState('3 / 3장', true);
  report('PHOTO_MAX_3_DISABLED');

  stage = 'PHOTO_CAP_4TH';
  await page.locator('#photos').setInputFiles(png('shop-4.png', 'P4'));
  await photoState('3 / 3장', true);
  const capError = (await page.locator('#photosError').textContent() || '').trim();
  if (!capError.includes('최대 3장')) throw new Error('PHOTO_FOURTH_NOT_CAPPED');
  report('PHOTO_FOURTH_CAPPED');

  stage = 'PHOTO_DELETE_REENABLE';
  await page.locator('#photosList .file-remove').first().click();
  await photoState('2 / 3장', false);
  report('PHOTO_DELETE_REENABLE');

  stage = 'PHOTO_READD';
  await page.locator('#photos').setInputFiles(png('shop-4.png', 'P4R'));
  await photoState('3 / 3장', true);
  report('PHOTO_READD_TO_3');

  // Minimize Production mutation: keep one final photo for the real submit.
  while ((await page.locator('#photosList .file-row').count()) > 1) {
    await page.locator('#photosList .file-remove').first().click();
  }
  await photoState('1 / 3장', false);
  report('PHOTO_FINAL_SUBMIT_COUNT_1');

  stage = 'OWNER_PROOF';
  await page.locator('#ownerProof').setInputFiles(png('proof.png', 'PROOF'));
  await page.waitForFunction(() => document.getElementById('ownerProofStatus')?.textContent?.trim() === '1 / 3개');
  report('OWNER_PROOF_1');

  const suffix = Date.now().toString(36);
  await page.locator('[name="ownerShopName"]').fill(`Production 809 UI ${suffix}`);
  await page.locator('[name="category"]').fill('카페');
  await page.locator('[name="hours"]').fill('평일 10:00~18:00');
  await page.locator('[name="servicePrice"]').fill('Production #809 bounded UI acceptance');
  await page.locator('[name="locationUse"]').fill('광주 남구 방림동 · 테스트 승인 범위');
  await page.locator('[name="contact"]').fill('단지온 1:1 문의');

  stage = 'SUBMIT';
  await page.locator('#submitBtn').click();
  await page.waitForFunction(
    (copy) => document.getElementById('toast')?.textContent?.includes(copy),
    SUCCESS_COPY,
    { timeout: 45_000 },
  );

  const storageResponses = apiEvents.filter((event) => event.path === '/api/v1/storage/objects');
  const applicationResponses = apiEvents.filter((event) => event.path === '/api/v1/me/business-applications');
  if (storageResponses.length !== 2 || storageResponses.some((event) => event.status !== 201)) {
    throw new Error(`STORAGE_RESPONSE_SET_${storageResponses.map((event) => event.status).join('_') || 'NONE'}`);
  }
  if (applicationResponses.length !== 1 || applicationResponses[0].status !== 201) {
    throw new Error(`APPLICATION_RESPONSE_SET_${applicationResponses.map((event) => event.status).join('_') || 'NONE'}`);
  }

  const uiState = await page.evaluate((genericFailure) => ({
    summaryHidden: document.getElementById('applicationErrorSummary')?.hidden === true,
    summaryText: document.getElementById('applicationErrorSummary')?.textContent || '',
    toastText: document.getElementById('toast')?.textContent || '',
    photoError: document.getElementById('photosError')?.textContent || '',
    bodyHasVisibleGenericFailure: [...document.querySelectorAll('body *')]
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .some((el) => el.children.length === 0 && el.textContent?.includes(genericFailure)),
  }), GENERIC_PHOTO_FAILURE);

  if (!uiState.summaryHidden || uiState.summaryText.trim()) throw new Error('APPLICATION_ERROR_SUMMARY_VISIBLE_AFTER_SUCCESS');
  if (!uiState.toastText.includes(SUCCESS_COPY)) throw new Error('SUCCESS_TOAST_MISSING');
  if (uiState.photoError.trim()) throw new Error('PHOTO_ERROR_VISIBLE_AFTER_SUCCESS');
  if (uiState.bodyHasVisibleGenericFailure) throw new Error('GENERIC_PHOTO_UPLOAD_FAILURE_VISIBLE');

  report('UI_STORAGE_UPLOAD_2X201');
  report('UI_APPLICATION_CREATE_201');
  report('UI_SUCCESS_TOAST');
  report('GENERIC_PHOTO_UPLOAD_FAILURE_VISIBLE', 'NO');
  report('PRODUCTION_809_UI_ACCEPTANCE');
  console.log('PRODUCTION_PRODUCT_DATA_MUTATION_SCOPE=business_image_upload_1+application_document_upload_1+business_application_create_1');
  console.log('ACCOUNT_PROVISIONING=0');
  console.log('HOUSEHOLD_PROVISIONING=0');
  console.log('AUTO_RETRY_FOR_MUTATIONS=0');
  console.log('SECRET_OUTPUT=0');

  stage = 'SIGN_OUT';
  await context.request.post(`${frontendBase}/api/auth/sign-out`, {
    headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
    data: {},
  }).catch(() => null);
} catch (error) {
  const code = sanitizeCode(error instanceof Error ? error.message : error);
  console.error(`PRODUCTION_809_UI_ACCEPTANCE_FAILED=${stage}:${code}`);
  if (apiEvents.length) {
    console.log(`DIAG_API_RESPONSES=${apiEvents.map((event) => `${event.status}:${event.path}`).join(' | ')}`);
  }
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
