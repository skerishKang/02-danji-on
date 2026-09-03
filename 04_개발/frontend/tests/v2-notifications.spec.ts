import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn notification center deep-links only allowlisted conversation and resident-news resources', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.locator('.v2-profile-dialog');
  const panel = profile.locator('[data-v2-notifications-panel]');

  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '알림' })).toBeVisible();
  await expect(panel.locator('[data-v2-notification-unread]')).toHaveText('3개 안 읽음');
  await expect(panel.locator('[data-v2-notification-item]')).toHaveCount(3);

  const residentNewsItem = panel.locator('[data-v2-notification-item]').filter({ hasText: '새 주민소식이 등록되었습니다' });
  await expect(residentNewsItem).toHaveAttribute('data-read', 'false');
  await residentNewsItem.getByRole('button', { name: '주민소식 열기' }).click();
  await expect(panel.locator('[data-v2-notification-unread]')).toHaveText('2개 안 읽음');
  await expect(residentNewsItem).toHaveAttribute('data-read', 'true');

  const residentNewsDialog = page.locator('[data-v2-resident-news-dialog]');
  await expect(residentNewsDialog).toBeVisible();
  const detail = residentNewsDialog.locator('[data-v2-resident-news-detail]');
  await expect(detail).toContainText('우리 단지 산책길 정비 소식');
  await expect(detail).toContainText('주민 제보를 운영 확인한 뒤 게시한 주민소식 예시입니다.');
  await residentNewsDialog.getByRole('button', { name: '닫기' }).click();

  const messageItem = panel.locator('[data-v2-notification-item]').filter({ hasText: '새 메시지가 도착했습니다' });
  await expect(messageItem).toHaveAttribute('data-read', 'false');
  await messageItem.getByRole('button', { name: '읽음' }).click();
  await expect(panel.locator('[data-v2-notification-unread]')).toHaveText('1개 안 읽음');
  await expect(messageItem).toHaveAttribute('data-read', 'true');

  await messageItem.getByRole('button', { name: '메시지함 열기' }).click();
  await expect(page).toHaveURL(/conversation=00000000-0000-4000-8000-000000000273/);

  await panel.getByRole('button', { name: '모두 읽음' }).click();
  await expect(panel.locator('[data-v2-notification-unread]')).toHaveText('0개 안 읽음');
  await expect(panel.getByRole('button', { name: '모두 읽음' })).toHaveCount(0);
});
