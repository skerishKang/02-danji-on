import { expect, test, type Page } from '@playwright/test';

const currentNav = ['홈', '이웃가게', '우리단지', '내정보'];
const currentConversationKinds = ['가입인사', '단지이야기', '궁금해요', '같이해요'];

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

    const shareSlot = dialog.locator('[data-v2-detail-share-slot]');
    const shareButton = dialog.getByRole('button', { name: '공유 링크 복사', exact: true });
    if ((page.viewportSize()?.width ?? 1440) <= 800) {
      await expect(shareSlot).toBeHidden();
      await expect(shareButton).toBeHidden();
    } else {
      await expect(shareSlot).toBeVisible();
      await expect(shareButton).toBeVisible();
    }

    await tabs.getByRole('button', { name: '후기', exact: true }).click();
    await expect(dialog.locator('[data-v2-business-reviews-slot]')).toBeVisible();

    const mobileActions = dialog.locator('.v2-008-detail-mobile-actions');
    if ((page.viewportSize()?.width ?? 1440) <= 800) {
      await expect(mobileActions).toBeVisible();
      await expect(mobileActions.getByRole('button', { name: /저장/ })).toBeVisible();
      await expect(mobileActions.getByRole('button', { name: '문의 방법 보기', exact: true })).toBeVisible();
    } else {
      await expect(mobileActions).toBeHidden();
    }
  });

  test('우리단지 opens current 05 hub before current 12 resident-only neighbor conversation', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    await nav.getByRole('button', { name: '우리단지', exact: true }).click();

    const hub = page.locator('[data-v2-complex-hub]');
    await expect(hub).toBeVisible();
    await expect(hub.getByRole('heading', { name: '우리단지', exact: true })).toBeVisible();
    for (const [channel, title, action] of [
      ['official', '단지온공지', '단지온공지 보기'],
      ['apartment', '아파트소식', '아파트소식 보기'],
      ['resident', '주민소식', '소식 보기 · 제보하기'],
      ['dialogue', '이웃대화', '이웃대화 들어가기']
    ] as const) {
      const card = hub.locator(`[data-v2-complex-channel="${channel}"]`);
      await expect(card.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: action, exact: true })).toBeVisible();
    }

    await hub.getByRole('button', { name: '이웃대화 들어가기', exact: true }).click();
    const community = page.locator('.v2-community-layer');
    await expect(community.getByRole('heading', { name: '이웃대화', exact: true })).toBeVisible();
    const topics = community.locator('.v2-community-topics');
    for (const label of currentConversationKinds) {
      await expect(topics.getByRole('button').filter({ hasText: label })).toBeVisible();
    }
    await expect(community.getByRole('button', { name: '전체 보기', exact: true })).toBeVisible();
    await expect(community.getByText('공식소식', { exact: true })).toHaveCount(0);
    await expect(community.getByText('생활제보', { exact: true })).toHaveCount(0);

    await topics.getByRole('button').filter({ hasText: '궁금해요' }).click();
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await expect(community.locator('.v2-community-mobile-write')).toBeVisible();
      await expect(community.locator('.v2-community-write-main')).toBeHidden();
    } else {
      await expect(community.getByRole('button', { name: /궁금해요 글쓰기/ })).toBeVisible();
    }
  });

  test('current 05 hub delegates public and resident news to existing portal authorities', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    await nav.getByRole('button', { name: '우리단지', exact: true }).click();
    const hub = page.locator('[data-v2-complex-hub]');

    await hub.getByRole('button', { name: '소식 보기 · 제보하기', exact: true }).click();
    const residentDialog = page.locator('[data-v2-resident-news-dialog]');
    await expect(residentDialog).toBeVisible();
    await expect(residentDialog.getByRole('heading', { name: '주민소식', exact: true })).toBeVisible();
    await residentDialog.getByRole('button', { name: '주민소식 닫기', exact: true }).click();
    await expect(hub).toBeVisible();

    await hub.getByRole('button', { name: '단지온공지 보기', exact: true }).click();
    const publicDialog = page.locator('[data-v2-complex-news-dialog]');
    await expect(publicDialog).toBeVisible();
    await expect(publicDialog.getByRole('heading', { name: '단지 공식소식', exact: true })).toBeVisible();
  });

  test('주민소식 follows current 10 list into current 11 detail without inventing absent server fields', async ({ page }) => {
    await page.goto('/');
    const nav = visiblePrimaryNav(page);
    await nav.getByRole('button', { name: '우리단지', exact: true }).click();
    const hub = page.locator('[data-v2-complex-hub]');
    await hub.getByRole('button', { name: '소식 보기 · 제보하기', exact: true }).click();

    const resident = page.locator('[data-v2-resident-news-dialog]');
    await expect(resident).toBeVisible();
    await expect(resident.getByText('주민이 전하는 우리 단지 이야기', { exact: true })).toBeVisible();
    await expect(resident.getByRole('heading', { name: '주민소식', exact: true })).toBeVisible();
    await expect(resident.getByText('주민이 직접 전한 소식입니다.', { exact: true })).toBeVisible();
    await expect(resident.getByRole('heading', { name: /우리 단지의.*좋은 소식을.*보내주세요/ })).toBeVisible();
    await expect(resident.getByRole('heading', { name: '최근 주민소식', exact: true })).toBeVisible();
    await expect(resident.getByText('분류값은 현재 API에 없으므로 임의로 추정하지 않습니다.', { exact: true })).toBeVisible();

    const list = resident.locator('[data-v2-resident-news-list]');
    const story = list.locator('[data-v2-resident-news-item]').filter({ hasText: '우리 단지 산책길 정비 소식' });
    await expect(story).toBeVisible();
    await story.getByRole('button', { name: /소식 읽기/ }).click();

    const detail = resident.locator('[data-v2-resident-news-detail]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('h1')).toHaveText('우리 단지 산책길 정비 소식');
    await expect(detail.locator('.v2-resident-news-article-meta').getByText('운영진 확인 후 게시', { exact: true })).toBeVisible();
    await expect(detail.getByText('주민 제보를 운영 확인한 뒤 게시한 주민소식 예시입니다.', { exact: true })).toBeVisible();
    await expect(detail.locator('img')).toHaveCount(0);

    await detail.getByRole('button', { name: /주민소식 전체 보기/ }).click();
    await expect(list).toBeVisible();
    await resident.getByRole('button', { name: /소식 제보하기/ }).click();

    const form = resident.locator('[data-v2-resident-news-form]');
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: '제목' })).toBeVisible();
    await expect(form.getByRole('textbox', { name: '알리고 싶은 내용' })).toBeVisible();
    await expect(form.locator('input[type="file"], input[type="email"], select')).toHaveCount(0);

    await resident.getByRole('button', { name: '내 제보', exact: true }).click();
    await expect(resident.locator('[data-v2-resident-news-submissions]')).toBeVisible();
    await expect(resident.getByText('공용 자전거 거치대 제보', { exact: true })).toBeVisible();
  });
});