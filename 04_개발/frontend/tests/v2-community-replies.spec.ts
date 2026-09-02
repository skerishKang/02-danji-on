import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('resident comment can open a one-level nested reply flow', async ({ page }) => {
  await page.getByRole('button', { name: '우리단지', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '우리단지', exact: true })).toBeVisible();

  await page.getByRole('button').filter({ hasText: '에어컨 청소 잘하는 이웃 계실까요?' }).click();
  await page.getByRole('button', { name: '댓글 남기기', exact: true }).click();
  await page.getByLabel('댓글', { exact: true }).fill('필터 청소 업체 추천 부탁드려요.');
  await page.getByRole('button', { name: '댓글 게시', exact: true }).click();

  const comment = page.locator('[data-v2-community-comment]').filter({ hasText: '필터 청소 업체 추천 부탁드려요.' });
  await expect(comment).toBeVisible();
  await comment.getByRole('button', { name: '답글 남기기', exact: true }).click();
  await comment.getByLabel('답글', { exact: true }).fill('저도 이번 주에 알아보고 있어요.');
  await comment.getByRole('button', { name: '답글 게시', exact: true }).click();

  const reply = comment.locator('[data-v2-community-reply]');
  await expect(reply).toHaveCount(1);
  await expect(reply).toContainText('저도 이번 주에 알아보고 있어요.');
  await expect(comment.locator('[data-v2-community-reply] [data-v2-community-reply]')).toHaveCount(0);
});
