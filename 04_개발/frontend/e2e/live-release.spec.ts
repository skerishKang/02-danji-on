import { expect, test } from '@playwright/test';

const surfaces = [
  '/',
  '/admin.html',
  '/verification.html',
  '/verification-admin.html'
];

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}

for (const path of surfaces) {
  test(`${path} loads without server error or horizontal overflow`, async ({ page }) => {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response, `${path} must return a navigation response`).not.toBeNull();
    expect(response!.status(), `${path} must not return a 5xx response`).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test('resident primary navigation remains usable at release viewports', async ({ page }, testInfo) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);

  await expect(page.locator('#home-search')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name.startsWith('mobile-')) {
    const mobileNav = page.locator('.mobile-nav');
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole('button', { name: /주민혜택/ }).click();
    await expect(page.getByRole('heading', { name: '주민혜택' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await mobileNav.getByRole('button', { name: /홈/ }).click();
    await expect(page.locator('#home-search')).toBeVisible();
  }
});
