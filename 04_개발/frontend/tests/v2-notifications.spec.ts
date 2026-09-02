import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn notification center reads canonical feed state and exposes only safe conversation deep-link', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const dialog = page.getByRole('dialog');
  const panel = dialog.locator('[data-v2-notifications-panel]');

  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '알림' })).toBeVisible();
  await expect(panel.locator('[data-v2-notification-unread]')).toHaveText('2개 안 읽음');
  await expect(panel.locator('[data-v2-notification-item]')).toHaveCount(2);

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
