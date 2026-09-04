import { expect, test, type Page } from '@playwright/test';

const currentNav = ['홈', '이웃가게', '우리단지', '내정보'];
const currentCommunityTabs = ['전체', '공식소식', '주민이야기', '질문', '같이해요', '생활제보', '우리 단지의 변화', '함께하는 곳'];

function visiblePrimaryNav(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  return width <= 800
    ? page.locator('[data-v2-mobile-nav]')
    : page.locator('[data-v2-topbar] nav[aria-label="주요 메뉴"]');
}

test.describe('DanjiOn current Product Shell C1', () => {
  test('visible nav follows the 20260904 four-destination shell', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    for (const label of currentNav) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: '혜택', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '주민혜택', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '단지소식', exact: true })).toHaveCount(0);
  });

  test('이웃가게 follows current 01 discovery into current 02 detail without replacing product authority', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    await nav.getByRole('button', { name: '이웃가게', exact: true }).click();

    const discovery = page.locator('[data-v2-section="discovery"]');
    await expect(discovery.getByRole('heading', { name: /가까이 사는.*이웃의 일을 발견합니다/ })).toBeVisible();
    await expect(discovery.getByPlaceholder('무슨 일이 필요하세요?')).toBeVisible();
    await expect(discovery.locator('.v2-008-shop-card-featured')).toBeVisible();
    await expect(discovery.locator('.v2-008-side-list .v2-integrated-shop-card')).toHaveCount(2);
    await expect(discovery.getByRole('heading', { name: '이웃가게 전체', exact: true })).toBeVisible();

    const firstCard = discovery.locator('.v2-integrated-shop-card').first();
    const shopName = (await firstCard.locator('h3').textContent())?.trim();
    expect(shopName).toBeTruthy();
    await firstCard.getByRole('button', { name: '상세보기', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: shopName! })).toBeVisible();
    const tabs = dialog.getByRole('navigation', { name: '가게 상세 메뉴' });
    for (const label of ['정보', '품목·서비스', '소식', '혜택', '후기']) {
      await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(dialog.locator('[data-v2-detail-share-slot]')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '공유 링크 복사', exact: true })).toBeVisible();

    await tabs.getByRole('button', { name: '후기', exact: true }).click();
    await expect(dialog.locator('[data-v2-business-reviews-slot]')).toBeVisible();

    const mobileActions = dialog.locator('.v2-008-detail-mobile-actions');
    if ((page.viewportSize()?.width ?? 1440) <= 800) {
      await expect(mobileActions).toBeVisible();
      await expect(mobileActions.getByRole('button', { name: '문의 방법 보기', exact: true })).toBeVisible();
    } else {
      await expect(mobileActions).toBeHidden();
    }
  });

  test('우리단지 preserves current resident conversation taxonomy in demo resident mode', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    await nav.getByRole('button', { name: '우리단지', exact: true }).click();
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
