import { expect, test } from '@playwright/test';

const currentNav = ['이웃가게', '혜택', '우리단지', '내정보'];
const currentCommunityTabs = ['전체', '공식소식', '주민이야기', '질문', '같이해요', '생활제보', '우리 단지의 변화', '함께하는 곳'];

test.describe('DanjiOn current Product Shell C1', () => {
  test('desktop nav exposes current 5-view semantics instead of legacy 단지소식', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('[data-v2-topbar] nav[aria-label="주요 메뉴"]');
    for (const label of currentNav) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: '단지소식', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '주민혜택', exact: true })).toHaveCount(0);
  });

  test('우리단지 preserves current resident conversation taxonomy in demo resident mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '우리단지', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: '우리단지', exact: true })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: '우리단지 글 종류' });
    for (const label of currentCommunityTabs) await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /궁금한 것 물어보기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /같이할 이웃 찾기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /편하게 이야기 나누기/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /생활 불편 알리기/ })).toBeVisible();
    await expect(page.getByText(/닉네임만 공개됩니다/)).toBeVisible();
  });
});
