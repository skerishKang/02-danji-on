import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn Household controls keep invite token ephemeral and require two-step member removal', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.locator('.v2-profile-dialog');
  const panel = profile.locator('[data-v2-household-panel]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('나의 단지온');
  await expect(panel).toContainText('가족 구성원');

  await panel.getByRole('button', { name: '가족 초대 만들기' }).click();
  const tokenBox = panel.locator('[data-v2-household-one-time-token]');
  await expect(tokenBox).toBeVisible();
  const token = await tokenBox.getByLabel('가족 초대 토큰').inputValue();
  expect(token.length).toBeGreaterThan(20);
  const persisted = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  expect(persisted).not.toContain(token);

  const pendingInvite = panel.locator('[data-v2-household-invite]').filter({ hasText: 'pending' }).first();
  await pendingInvite.getByRole('button', { name: '초대 회수' }).click();
  await expect(panel.locator('[data-v2-household-one-time-token]')).toHaveCount(0);

  const member = panel.locator('[data-v2-household-member]').filter({ hasText: '가족 구성원' });
  await member.getByRole('button', { name: '세대원 해제' }).click();
  await expect(member.getByRole('button', { name: '정말 해제' })).toBeVisible();
  await member.getByRole('button', { name: '정말 해제' }).click();
  await expect(panel.locator('[data-v2-household-member]').filter({ hasText: '가족 구성원' })).toHaveCount(0);
});
