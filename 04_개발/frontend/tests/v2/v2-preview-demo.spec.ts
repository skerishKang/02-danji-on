import { expect, test } from '@playwright/test';

const demoEnabled = process.env.VITE_PREVIEW_DEMO_MODE === 'true';

test('preview role selector is absent unless explicitly enabled', async ({ page }) => {
  await page.goto('/');
  if (demoEnabled) {
    await expect(page.getByLabel('시연 역할')).toBeVisible();
    await expect(page.getByText('PREVIEW ONLY')).toBeVisible();
  } else {
    await expect(page.getByLabel('시연 역할')).toHaveCount(0);
    await expect(page.getByText('PREVIEW ONLY')).toHaveCount(0);
  }
});
