import { test, expect, type Page } from '@playwright/test';

// Issue #826 [Owner Production QA][25A] regression:
// ?mode=report first mount used to leave a hidden .owner-only required control
// (ownerRelationEtc) enabled, so the browser's native constraint validation
// silently blocked "이웃가게 제보하기" submits with only a console error.
// Real DOM/browser level coverage for invariants A-D (inactive-mode disabled,
// etc-field gating, immediate deep-link use, stale-state-free tab transitions).

const BASE = 'http://127.0.0.1:4174';
const PAGE_PATH = '/25A_' + encodeURIComponent('신청제보') + '.html';

type Guard = {
  pageErrors: string[];
  consoleErrors: string[];
  reportPosts: Array<Record<string, unknown>>;
  assertNoInvalidControlError(): Promise<void>;
};

async function installGuard(page: Page): Promise<Guard> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const reportPosts: Array<Record<string, unknown>> = [];

  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to load resource')) return;
    consoleErrors.push(text);
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const local = url.origin === BASE;

    if (!local) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    if (url.pathname === '/api/auth/get-session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { id: 'qa826-session', userId: 'qa826-member', expiresAt: '2099-01-01T00:00:00.000Z' },
          user: {
            id: 'qa826-member',
            name: 'QA 826 주민',
            email: 'qa826-member@example.invalid',
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/auth/list-accounts') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ providerId: 'credential' }]) });
      return;
    }

    if (url.pathname === '/api/v1/me/shop-recommendations' && method === 'POST') {
      reportPosts.push(JSON.parse(request.postData() || '{}') as Record<string, unknown>);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: '00000000-0000-4000-8000-000000000826', status: 'pending' } })
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  return {
    pageErrors,
    consoleErrors,
    reportPosts,
    async assertNoInvalidControlError() {
      expect(pageErrors, 'pageerror must stay empty').toEqual([]);
      const blockers = consoleErrors.filter(text => text.includes('invalid form control'));
      expect(blockers, 'browser must never report a hidden invalid form control').toEqual([]);
    }
  };
}

function withApi(query: string): string {
  return PAGE_PATH + '?' + query + '&apiBase=' + encodeURIComponent(BASE);
}

async function activeValidationBlockers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const form = document.querySelector('#requestForm') as HTMLFormElement;
    return [...form.elements]
      .filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)
      .filter(el => !el.disabled && el.willValidate && !el.checkValidity())
      .map(el => el.name || el.id || el.tagName);
  });
}

async function controlState(page: Page, selector: string) {
  return page.locator(selector).evaluate(el => {
    const input = el as HTMLInputElement;
    return { disabled: input.disabled, required: input.required, wrapped: !!el.closest('[hidden]') };
  });
}

async function fillReportRequired(page: Page) {
  await page.locator('input[name="reportShopName"]').fill('게이트 제보 가게');
  await page.locator('select[name="reportRelation"]').selectOption('neighbor');
  await page.locator('textarea[name="reportWhat"]').fill('이웃이 운영하는 꽃다발 가게입니다.');
  await page.locator('textarea[name="reportLocation"]').fill('광주 남구 방림동 인근');
  await page.locator('textarea[name="reportReason"]').fill('주민 소개로 알게 된 가게입니다.');
}

async function fillReportTextRequired(page: Page) {
  await page.locator('input[name="reportShopName"]').fill('게이트 제보 가게');
  await page.locator('textarea[name="reportWhat"]').fill('이웃이 운영하는 꽃다발 가게입니다.');
  await page.locator('textarea[name="reportLocation"]').fill('광주 남구 방림동 인근');
  await page.locator('textarea[name="reportReason"]').fill('주민 소개로 알게 된 가게입니다.');
}

async function fillOwnerRequired(page: Page) {
  await page.locator('input[name="ownerShopName"]').fill('게이트 등록 가게');
  await page.locator('input[name="category"]').fill('꽃집');
  await page.locator('input[name="hours"]').fill('평일 운영');
  await page.locator('textarea[name="servicePrice"]').fill('꽃다발 제작');
  await page.locator('textarea[name="locationUse"]').fill('방림동 인근');
  await page.locator('input[name="contact"]').fill('단지온 문의');
}

test('#826 Test 1 — direct ?mode=report mount submits without a hidden owner blocker', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('mode=report'));

  const ownerControls = await page.evaluate(() =>
    [...document.querySelectorAll('.owner-only input,.owner-only textarea,.owner-only select')]
      .filter(el => (el as HTMLInputElement).disabled !== true)
      .map(el => (el as HTMLInputElement).name || el.id));
  expect(ownerControls, 'every owner-only control must be disabled in report mode').toEqual([]);

  const etc = await controlState(page, '#ownerEtc');
  expect(etc.disabled).toBe(true);
  expect(etc.required).toBe(false);

  // Reproduce the production failure seed: an out-of-band change on the
  // inactive owner relation (the pre-fix toggleEtc re-enabled the hidden field).
  await page.evaluate(() => {
    const select = document.querySelector('#ownerRelation') as HTMLSelectElement;
    select.value = 'etc';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const etcAfter = await controlState(page, '#ownerEtc');
  expect(etcAfter.disabled, 'inactive-mode etc field must stay disabled').toBe(true);
  expect(etcAfter.required, 'inactive-mode etc field must not be required').toBe(false);

  await fillReportRequired(page);
  expect(await activeValidationBlockers(page), 'no active control may block submit').toEqual([]);
  expect(await page.evaluate(() => (document.querySelector('#requestForm') as HTMLFormElement).checkValidity())).toBe(true);

  await page.locator('#submitBtn').click();
  await expect.poll(() => guard.reportPosts.length, { timeout: 10_000 }).toBe(1);
  expect(guard.reportPosts[0]).toMatchObject({
    businessName: '게이트 제보 가게',
    relationRaw: 'neighbor',
    serviceSummary: '이웃이 운영하는 꽃다발 가게입니다.'
  });
  await expect(page.locator('#toast')).toHaveText('제보가 접수됐습니다. 확인 후 등록됩니다.');
  await guard.assertNoInvalidControlError();
});

test('#826 Test 2 — direct ?mode=owner mount keeps report controls disabled', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('mode=owner'));

  const reportControls = await page.evaluate(() =>
    [...document.querySelectorAll('.report-only input,.report-only textarea,.report-only select')]
      .filter(el => (el as HTMLInputElement).disabled !== true)
      .map(el => (el as HTMLInputElement).name || el.id));
  expect(reportControls, 'every report-only control must be disabled in owner mode').toEqual([]);

  await expect(page.locator('input[name="ownerShopName"]')).toBeEnabled();
  await expect(page.locator('select[name="ownerRelation"]')).toBeEnabled();
  await guard.assertNoInvalidControlError();
});

test('#826 Test 3 — owner etc toggles visibility and native validity correctly', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('mode=owner'));

  await page.locator('select[name="ownerRelation"]').selectOption('etc');
  await expect(page.locator('#ownerEtcWrap')).toBeVisible();
  const on = await controlState(page, '#ownerEtc');
  expect(on.required).toBe(true);
  expect(on.disabled).toBe(false);
  const blockers = await activeValidationBlockers(page);
  expect(blockers, 'visible required ownerEtc is the only intentional blocker').toContain('ownerRelationEtc');

  await fillOwnerRequired(page);
  await page.locator('#ownerEtc').fill('운영자를 돕는 가족입니다.');
  expect(await activeValidationBlockers(page)).toEqual([]);
  expect(await page.evaluate(() => (document.querySelector('#requestForm') as HTMLFormElement).checkValidity())).toBe(true);

  await page.locator('select[name="ownerRelation"]').selectOption('family');
  await expect(page.locator('#ownerEtcWrap')).toBeHidden();
  const off = await controlState(page, '#ownerEtc');
  expect(off.required, 'deselected etc field must not keep required state').toBe(false);
  expect(off.disabled).toBe(true);
  expect(await activeValidationBlockers(page)).toEqual([]);
  await guard.assertNoInvalidControlError();
});

test('#826 Test 4 — report etc toggles visibility and native validity correctly', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('mode=report'));

  await page.locator('select[name="reportRelation"]').selectOption('etc');
  await expect(page.locator('#reportEtcWrap')).toBeVisible();
  const on = await controlState(page, '#reportEtc');
  expect(on.required).toBe(true);
  expect(on.disabled).toBe(false);

  await fillReportTextRequired(page);
  await page.locator('#reportEtc').fill('단골로 알게 된 사이입니다.');
  expect(await activeValidationBlockers(page)).toEqual([]);
  expect(await page.evaluate(() => (document.querySelector('#requestForm') as HTMLFormElement).checkValidity())).toBe(true);

  const owner = await controlState(page, '#ownerEtc');
  expect(owner.disabled, 'report-mode etc change must not re-enable owner fields').toBe(true);
  expect(owner.required).toBe(false);

  await page.locator('select[name="reportRelation"]').selectOption('nearby');
  await expect(page.locator('#reportEtcWrap')).toBeHidden();
  const off = await controlState(page, '#reportEtc');
  expect(off.required).toBe(false);
  expect(off.disabled).toBe(true);
  await guard.assertNoInvalidControlError();
});

test('#826 Test 5 — repeated owner/report tab transitions leave no stale required or disabled state', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('mode=owner'));

  await page.locator('select[name="ownerRelation"]').selectOption('etc');
  await page.locator('#ownerEtc').fill('운영자를 돕는 가족입니다.');

  for (let round = 0; round < 2; round++) {
    await page.locator('#reportTab').click();
    const ownerAfter = await controlState(page, '#ownerEtc');
    expect(ownerAfter.disabled, 'round ' + round + ': owner etc must be disabled under report').toBe(true);
    expect(ownerAfter.required, 'round ' + round + ': owner etc must not block report submits').toBe(false);
    await expect(page.locator('#ownerEtcWrap')).toBeHidden();

    await fillReportRequired(page);
    expect(await activeValidationBlockers(page), 'report must be submittable after transitions').toEqual([]);

    await page.locator('#ownerTab').click();
    const ownerBack = await controlState(page, '#ownerEtc');
    expect(ownerBack.disabled, 'owner active again must restore etc control').toBe(false);
    expect(ownerBack.required, 'owner-side etc selection must persist as required').toBe(true);
    await expect(page.locator('#ownerEtcWrap')).toBeVisible();

    await page.locator('select[name="reportRelation"]').evaluate(el => { (el as HTMLSelectElement).value = 'etc'; });
    const reportWhileOwner = await controlState(page, '#reportEtc');
    expect(reportWhileOwner.disabled, 'inactive report etc must stay disabled').toBe(true);
    expect(reportWhileOwner.required).toBe(false);
  }

  await page.locator('#reportTab').click();
  await fillReportRequired(page);
  await page.locator('#submitBtn').click();
  await expect.poll(() => guard.reportPosts.length, { timeout: 10_000 }).toBe(1);
  await guard.assertNoInvalidControlError();
});
