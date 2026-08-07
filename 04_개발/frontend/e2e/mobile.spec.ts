import { expect, test } from '@playwright/test';

test('mobile bottom navigation works without horizontal overflow', async ({ page }) => {
  await page.goto('/');

  const mobileNav = page.locator('.mobile-nav');
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole('button', { name: /주민혜택/ }).click();
  await expect(page.getByRole('heading', { name: '주민혜택' })).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasOverflow).toBe(false);

  await mobileNav.getByRole('button', { name: /홈/ }).click();
  await expect(page.locator('#home-search')).toBeVisible();
});
