import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn inbox opens conversation, marks read and sends a canonical message', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.getByRole('dialog');
  const inbox = profile.locator('[data-v2-messages-panel]');

  await expect(inbox).toBeVisible();
  await expect(inbox.getByRole('heading', { name: '메시지' })).toBeVisible();
  await expect(inbox.locator('[data-v2-message-unread]')).toHaveText('1개 안 읽음');
  const conversation = inbox.locator('[data-v2-conversation-item]').filter({ hasText: '이웃 주민' });
  await expect(conversation).toHaveAttribute('data-unread', '1');

  await conversation.getByRole('button', { name: '대화 열기' }).click();
  const dialog = page.locator('[data-v2-conversation-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '이웃 주민님과의 대화' })).toBeVisible();
  await expect(dialog).toContainText('안녕하세요. 단지온 메시지입니다.');
  await expect(inbox.locator('[data-v2-message-unread]')).toHaveText('0개 안 읽음');
  await expect(page).toHaveURL(/conversation=00000000-0000-4000-8000-000000000273/);

  const body = `QA 메시지 ${Date.now()}`;
  await dialog.getByLabel('메시지').fill(body);
  await dialog.getByRole('button', { name: '보내기' }).click();
  await expect(dialog.getByText(body, { exact: true })).toBeVisible();
  await expect(dialog).toContainText('메시지를 보냈습니다.');

  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('[data-v2-conversation-dialog]')).toHaveCount(0);
});

test('notification conversation deep-link opens the V2 conversation dialog', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.getByRole('dialog');
  const notifications = profile.locator('[data-v2-notifications-panel]');
  const messageNotification = notifications.locator('[data-v2-notification-item]').filter({ hasText: '새 메시지가 도착했습니다' });

  await messageNotification.getByRole('button', { name: '메시지함 열기' }).click();
  const dialog = page.locator('[data-v2-conversation-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '이웃 주민님과의 대화' })).toBeVisible();
  await expect(page).toHaveURL(/conversation=00000000-0000-4000-8000-000000000273/);
});
