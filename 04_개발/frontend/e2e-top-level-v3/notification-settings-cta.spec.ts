import { test, expect, type Page } from '@playwright/test';

// Issue #858 [Refs #787]: 27_알림함 -> 알림 설정 CTA -> 24_설정.html#notifications.
//
// The static markup (and the leaf-b858 source contract) already prove the two CTAs
// exist with the canonical target. What they cannot prove is the runtime behaviour:
// frontend/assets/consistency.js runs a page-27 branch after load, and it used to
// call removeAll('.side'), which hard-removed the whole <aside class="side"> —
// including the .side-action CTA — even though the static markup was correct.
//
// #982 adds a signed-out Settings gate. These tests therefore cover both boundaries:
// authenticated CTA navigation must reveal the canonical notifications panel, while
// direct signed-out Settings navigation must keep private member content hidden.

const TARGET_URL = /\/24_[^/]*\.html#notifications$/;
const SETTINGS_PANEL = 'article#notifications';
const SETTINGS_GATE = '#settingsAccessGate';
const SETTINGS_PRIVATE_CONTENT = '#settingsPrivateContent';

async function gotoPage(page: Page, file: string): Promise<string[]> {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/' + encodeURI(file), { waitUntil: 'load' });
  return pageErrors;
}

async function mockAuthenticatedSettingsSession(page: Page): Promise<void> {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/auth/get-session') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id: 'e2e-settings-session' },
        user: { id: 'e2e-settings-user' },
      }),
    });
  });
}

test('#858 consistency.js keeps the 27 notification-settings side CTA at runtime', async ({ page }) => {
  const pageErrors = await gotoPage(page, '27_알림함.html');
  await expect(page.locator('.notice-layout > aside.side')).toHaveCount(1);
  await expect(page.locator('.notice-layout > aside.side .side-action')).toBeVisible();
  await expect(page.locator('.filter-bar .settings-link')).toBeVisible();
  expect(pageErrors, '27_알림함.html must load without runtime errors').toEqual([]);
});

test('#858 primary .settings-link reveals authenticated 24_설정.html#notifications', async ({ page }) => {
  await mockAuthenticatedSettingsSession(page);
  const pageErrors = await gotoPage(page, '27_알림함.html');
  await page.locator('.filter-bar .settings-link').click();
  await expect(page).toHaveURL(TARGET_URL);
  await expect(page.locator(SETTINGS_PANEL)).toBeVisible();
  await expect(page.locator(SETTINGS_PANEL)).toBeInViewport();
  expect(pageErrors, 'authenticated Settings navigation must have no page errors').toEqual([]);
});

test('#858 side .side-action reveals authenticated 24_설정.html#notifications', async ({ page }) => {
  await mockAuthenticatedSettingsSession(page);
  const pageErrors = await gotoPage(page, '27_알림함.html');
  await page.locator('.notice-layout > aside.side .side-action').click();
  await expect(page).toHaveURL(TARGET_URL);
  await expect(page.locator(SETTINGS_PANEL)).toBeVisible();
  await expect(page.locator(SETTINGS_PANEL)).toBeInViewport();
  expect(pageErrors, 'authenticated Settings navigation must have no page errors').toEqual([]);
});

test('#982 direct signed-out Settings route hides private shell and makes no member API calls', async ({ page }) => {
  const memberApiRequests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) memberApiRequests.push(url.pathname);
  });
  const pageErrors = await gotoPage(page, '24_설정.html');
  await expect(page.locator(SETTINGS_GATE)).toBeVisible();
  await expect(page.locator(SETTINGS_PRIVATE_CONTENT)).toBeHidden();
  await expect(page.locator('#settingsGuestLogin')).toBeVisible();
  expect(memberApiRequests, 'signed-out Settings must not hydrate member APIs').toEqual([]);
  expect(pageErrors, 'signed-out Settings gate must have no page errors').toEqual([]);
});

test('#858 page-28 scoped side removal is unchanged', async ({ page }) => {
  await gotoPage(page, '28_나의활동.html');
  await expect(page.locator('.activity-layout > .side')).toHaveCount(0);
});
