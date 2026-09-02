import { expect, test } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('My DanjiOn account closure requires the exact confirmation and preserves provider boundary', async ({ page }) => {
  await page.getByRole('button', { name: '내정보' }).first().click();
  const profile = page.locator('.v2-profile-dialog');
  const panel = profile.locator('[data-v2-account-closure-panel]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('외부 로그인 제공자 계정 자체는 삭제하지 않습니다.');

  const input = panel.getByLabel('계정 종료 확인 문구');
  const closeButton = panel.getByRole('button', { name: '단지온 계정 종료' });
  await expect(closeButton).toBeDisabled();
  await input.fill('CLOSE_DANJION');
  await expect(closeButton).toBeDisabled();
  await input.fill('CLOSE_DANJION_ACCOUNT');
  await expect(closeButton).toBeEnabled();
  await closeButton.click();

  await expect(panel.locator('[data-v2-account-closure-complete]')).toBeVisible();
  await expect(panel).toContainText('단지온 계정 종료 완료');
  await expect(panel).toContainText('외부 로그인 제공자 계정은 삭제하지 않습니다.');
});
