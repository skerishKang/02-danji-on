import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow } from './v2/v2-test-helpers';

test('gateway exposes isolated V1/V2 destinations and never masquerades as a product surface', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);

  const root = page.locator('[data-ui-variant="gateway"]');
  await expect(root).toBeVisible();
  await expect(page.getByRole('heading', { name: /같은 단지온을.*두 화면으로 비교합니다/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '단지온 V1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '단지온 V2' })).toBeVisible();
  await expect(page.getByText('V2 화면 통합 대기 중')).toHaveCount(0);
  await expect(page.locator('#home-search')).toHaveCount(0);

  const v1 = page.locator('a[data-version-target="v1"]');
  const v2 = page.locator('a[data-version-target="v2"]');
  await expect(v1).toHaveAttribute('href', process.env.DANJION_EXPECTED_V1_URL || 'http://127.0.0.1:4181/');
  await expect(v2).toHaveAttribute('href', process.env.DANJION_EXPECTED_V2_URL || 'http://127.0.0.1:4182/');
  await expectNoHorizontalOverflow(page);
});
