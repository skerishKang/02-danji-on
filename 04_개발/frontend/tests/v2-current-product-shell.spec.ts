import { expect, test, type Page } from '@playwright/test';

const currentNav = ['이웃가게', '혜택', '우리단지', '내정보'];
const currentCommunityTabs = ['전체', '공식소식', '주민이야기', '질문', '같이해요', '생활제보', '우리 단지의 변화', '함께하는 곳'];

function visiblePrimaryNav(page: Page) {
  const width = page.viewportSize()?.width ?? 1440;
  return width <= 700
    ? page.locator('[data-v2-mobile-nav]')
    : page.locator('[data-v2-topbar] nav[aria-label="주요 메뉴"]');
}

test.describe('DanjiOn current Product Shell C1', () => {
  test('visible nav exposes current 5-view semantics instead of legacy 단지소식', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    for (const label of currentNav) await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: '단지소식', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: '주민혜택', exact: true })).toHaveCount(0);
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

  test('resident news stays separate from public official news and supports verified submission workflow', async ({ page }) => {
    await page.goto('/');
    const entry = page.locator('[data-v2-resident-news-entry]');
    await expect(entry).toBeVisible();
    await entry.getByRole('button', { name: '주민소식 보기', exact: true }).click();

    const dialog = page.locator('[data-v2-resident-news-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '입주민 주민소식', exact: true })).toBeVisible();
    await expect(dialog.getByText('입주민 확인을 거쳐 게시된 주민소식입니다', { exact: true })).toBeVisible();

    await dialog.getByRole('button', { name: '내용 보기', exact: true }).click();
    await expect(dialog.locator('[data-v2-resident-news-detail]')).toContainText('주민이 제보한 내용은 운영 확인 후 주민전용 소식으로 별도 게시됩니다.');
    await dialog.getByRole('button', { name: '목록으로', exact: true }).click();

    await dialog.getByRole('button', { name: '소식 제보하기', exact: true }).click();
    await dialog.getByLabel('제목', { exact: true }).fill('엘리베이터 앞 조명 확인 부탁드립니다');
    await dialog.getByLabel('내용', { exact: true }).fill('공용부 조명이 꺼져 있어 운영 확인을 요청드립니다.');
    await dialog.getByRole('button', { name: '제보 접수', exact: true }).click();

    await expect(dialog.locator('[data-v2-resident-news-mine]')).toContainText('엘리베이터 앞 조명 확인 부탁드립니다');
    await expect(dialog.locator('[data-v2-resident-news-mine]')).toContainText('접수됨');
    await expect(dialog.getByText(/운영 확인 전에는 주민소식 피드에 게시되지 않습니다/)).toBeVisible();
  });
});
