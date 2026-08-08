import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './v2/v2-test-helpers';

test('unset/explicit/invalid non-V2 variants fail safely to the existing V1 surface', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);

  await expect(page.locator('#home-search')).toBeVisible();
  await expect(page.locator('[data-ui-variant="v2"]')).toHaveCount(0);
  await expect(page.locator('[data-ui-variant="gateway"]')).toHaveCount(0);
  await expect(page.getByText('V2 화면 통합 대기 중')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
