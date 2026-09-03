import { expect, test } from '@playwright/test';

test.describe('V2 My DanjiOn canonical summary', () => {
  test('My dialog renders the safe summary projection without private residence fields', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '내정보', exact: true }).first().click();

    const dialog = page.locator('.v2-profile-dialog');
    await expect(dialog).toBeVisible();

    const summary = dialog.locator('[data-v2-my-summary]');
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('heading', { name: '내 단지온 요약' })).toBeVisible();
    await expect(summary.locator('[data-summary-key="post"]')).toContainText('2개');
    await expect(summary.locator('[data-summary-key="comment"]')).toContainText('4개');
    await expect(summary.locator('[data-summary-key="reaction"]')).toContainText('7개');
    await expect(summary.locator('[data-summary-key="saved-business"]')).toContainText('3개');
    await expect(summary.locator('[data-summary-key="unread-message"]')).toContainText('1개');
    await expect(summary.locator('[data-summary-key="household"]')).toContainText('인증 완료 · 세대 대표');

    await expect(summary).not.toContainText(/동\s*·?\s*호|세대\s*ID|멤버십\s*ID|주민코드|인증서류|제공자\s*ID/i);
    await expect(dialog.locator('[data-v2-profile-activity]')).toBeVisible();
  });
});
