import { test, expect, type Page } from '@playwright/test';

// Issue #858 [Refs #787]: 27_알림함 -> 알림 설정 CTA -> 24_설정.html#notifications.
//
// The static markup (and the leaf-b858 source contract) already prove the two CTAs
// exist with the canonical target. What they cannot prove is the runtime behaviour:
// frontend/assets/consistency.js runs a page-27 branch after load, and it used to
// call removeAll('.side'), which hard-removed the whole <aside class="side"> —
// including the .side-action CTA — even though the static markup was correct.
//
// This is the runtime contract: consistency.js runs, the CTA-carrying side panel
// survives, and clicking either CTA lands on the canonical settings target with the
// #notifications panel actually on screen. Issue #982 now gates the Settings shell,
// so the navigation tests provide a valid shared-session response before clicking.

const TARGET_URL = /\/24_[^/]*\.html#notifications$/;
const SETTINGS_PANEL = 'article#notifications';

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

  // consistency.js's page-27 branch must not delete the CTA-carrying side panel.
  await expect(page.locator('.notice-layout > aside.side')).toHaveCount(1);
  await expect(page.locator('.notice-layout > aside.side .side-action')).toBeVisible();

  // The primary filter-bar entry stays alive too.
  await expect(page.locator('.filter-bar .settings-link')).toBeVisible();

  expect(pageErrors, '27_알림함.html must load without runtime errors').toEqual([]);
});

test('#858 primary .settings-link lands on 24_설정.html#notifications', async ({ page }) => {
  await gotoPage(page, '27_알림함.html');
  await mockAuthenticatedSettingsSession(page);
  await page.locator('.filter-bar .settings-link').click();
  await expect(page).toHaveURL(TARGET_URL);
  await expect(page.locator(SETTINGS_PANEL)).toBeVisible();
  await expect(page.locator(SETTINGS_PANEL)).toBeInViewport();
});

test('#858 side .side-action lands on 24_설정.html#notifications', async ({ page }) => {
  await gotoPage(page, '27_알림함.html');
  await mockAuthenticatedSettingsSession(page);
  await page.locator('.notice-layout > aside.side .side-action').click();
  await expect(page).toHaveURL(TARGET_URL);
  await expect(page.locator(SETTINGS_PANEL)).toBeVisible();
  await expect(page.locator(SETTINGS_PANEL)).toBeInViewport();
});

test('#858 page-28 scoped side removal is unchanged', async ({ page }) => {
  await gotoPage(page, '28_나의활동.html');
  // Page 28 keeps its own already-scoped removal; the #858 fix must not touch it.
  await expect(page.locator('.activity-layout > .side')).toHaveCount(0);
});
