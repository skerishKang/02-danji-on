import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('business detail shows resident reviews, owner reply and creates a text review', async ({ page }) => {
  const card = page.locator('.v2-integrated-shop-card[data-shop-id="food-01"]');
  await card.getByRole('button', { name: '상세보기' }).click();

  const detail = page.locator('.v2-detail-dialog');
  await expect(detail).toBeVisible();
  const reviews = detail.locator('[data-v2-business-reviews]');
  await expect(reviews).toBeVisible();
  await expect(reviews).toContainText('반찬이 깔끔하고 이웃에게 추천하기 좋았습니다.');
  await expect(reviews.locator('[data-v2-owner-reply]')).toContainText('이용해 주셔서 감사합니다.');

  const body = `QA 후기 ${Date.now()}`;
  await reviews.getByLabel('후기 남기기').fill(body);
  await reviews.getByRole('button', { name: '후기 등록' }).click();
  await expect(reviews.getByText(body, { exact: true })).toBeVisible();
  await expect(reviews).toContainText('후기를 등록했습니다.');
  await expect(reviews).not.toContainText(/별점|평점|동\s*·?\s*호|세대코드/);
});
