import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('public complex news entry opens canonical list and stable-ID detail', async ({ page }) => {
  const entry = page.locator('[data-v2-complex-news-entry]');
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('단지 공식소식');
  await entry.getByRole('button', { name: '공식소식 보기' }).click();

  const dialog = page.locator('[data-v2-complex-news-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '단지 공식소식' })).toBeVisible();
  const first = dialog.locator('[data-v2-complex-news-item]').first();
  await expect(first).toContainText('8월 입주자대표회의 활동 안내');
  await first.getByRole('button', { name: '내용 보기' }).click();

  const detail = dialog.locator('[data-v2-complex-news-detail]');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('8월 입주자대표회의 활동 일정을 안내드립니다.');
  await expect(detail).not.toContainText(/동\s*·?\s*호|호수|세대코드|object[_-]?key/i);
  await detail.getByRole('button', { name: '목록으로' }).click();
  await expect(dialog.locator('[data-v2-complex-news-list]')).toBeVisible();
});
