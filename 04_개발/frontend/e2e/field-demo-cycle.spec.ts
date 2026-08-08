import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function resetDemoState(page: Page) {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

async function registerHangyeol(page: Page) {
  await page.getByRole('button', { name: '내 일 알리기', exact: true }).click();
  await page.getByRole('button', { name: '다음 단계' }).click();
  await page.getByLabel('가게·서비스명 *').fill('한결수학');
  await page.getByLabel('분야 *').fill('과외·수업');
  await page.getByLabel('한 줄 소개 *').fill('중·고등학생 수학 과외');
  await page.getByLabel('가격').fill('중등 수학 월 18만원부터');
  await page.getByLabel('이용 지역').fill('방림명지로드힐과 인근 지역');
  await page.getByRole('button', { name: '다음 단계' }).click();
  await page.getByLabel('입주민 혜택').fill('방림명지로드힐 학생 첫 수업 무료');
  await page.getByRole('button', { name: '다음 단계' }).click();
  await expect(page.getByText('주민에게 공개')).toBeVisible();
  await expect(page.getByText('운영 확인 · 일반 공개 안 함')).toBeVisible();
  await page.getByRole('button', { name: '등록 신청 완료' }).click();
  await expect(page.locator('.application-item').filter({ hasText: '한결수학' })).toBeVisible();
}

test('five-minute field demo completes the full living-neighbor economy cycle', async ({ page }) => {
  await resetDemoState(page);

  // 발견 → 검색 → 상세
  await page.getByLabel('어떤 가게나 서비스가 필요하세요?').fill('반찬');
  await page.getByRole('button', { name: '검색하기' }).click();
  await expect(page.getByRole('heading', { name: '가게와 서비스' })).toBeVisible();
  const mealCard = page.locator('.service-card').filter({ hasText: '정다운 반찬가게' });
  await expect(mealCard).toBeVisible();
  await mealCard.getByRole('button', { name: '정다운 반찬가게 상세 보기' }).click();
  await expect(page.getByRole('heading', { name: '정다운 반찬가게' })).toBeVisible();

  // 주민혜택 받기 → 내정보 보관
  const detailBenefit = page.locator('.detail-benefit-wallet');
  await detailBenefit.getByRole('button', { name: '주민혜택 받기' }).click();
  await expect(detailBenefit.getByText('DANJION-0248 · 보관 중')).toBeVisible();
  await page.getByRole('button', { name: '내정보' }).first().click();
  const walletItem = page.locator('.my-benefit-item').filter({ hasText: '첫 방문 10% 할인' });
  await expect(walletItem).toBeVisible();
  await expect(walletItem.getByText('DANJION-0248')).toBeVisible();

  // 내 일 등록 4단계
  await registerHangyeol(page);

  // 홍보물 3종
  const application = page.locator('.application-item').filter({ hasText: '한결수학' });
  await application.getByRole('link', { name: '한결수학 홍보물 만들기' }).click();
  await page.getByRole('button', { name: '홍보물 만들기' }).click();
  await expect(page.locator('.promo-output.is-built')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '단지온 가게소개 카드' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '카카오톡 공유 이미지' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '엘리베이터 게시판 포스터' })).toBeVisible();

  // 운영확인 → 승인 공개
  await page.goto('/admin.html');
  const adminCard = page.locator('.admin-application-card').filter({ hasText: '한결수학' });
  await adminCard.getByRole('link', { name: '한결수학 운영확인' }).click();
  await expect(page.locator('.review-public-panel')).toContainText('중·고등학생 수학 과외');
  await expect(page.locator('.review-private-panel')).toContainText('확인자료 1건');
  await page.getByRole('button', { name: '승인하여 공개' }).click();
  await expect(page.getByText('한결수학이 주민에게 공개됐습니다.')).toBeVisible();

  const countText = await page.locator('.published-count strong').textContent();
  const transition = countText?.match(/(\d+)\s*→\s*(\d+)/);
  expect(transition).not.toBeNull();
  const before = Number(transition?.[1]);
  const after = Number(transition?.[2]);
  expect(after).toBe(before + 1);

  // 다시 발견
  await page.getByRole('link', { name: '주민 공개목록에서 확인' }).click();
  const highlighted = page.locator('.service-card.deep-link-highlight').filter({ hasText: '한결수학' });
  await expect(highlighted).toBeVisible();
  await expect(page.locator('.result-summary strong')).toHaveText(`${after}개의 가게와 서비스`);

  // 생활경제 엔딩
  await highlighted.getByRole('link', { name: '한결수학 승인 이후 생활경제 순환 보기' }).click();
  await expect(page).toHaveURL(/\/ending\.html\?businessName=/);
  await expect(page.getByRole('heading', { name: /우리 단지의 소비가/ })).toBeVisible();
  await expect(page.getByText('한결수학이 승인 후 주민 공개목록에서 다시 발견됐습니다.')).toBeVisible();
  for (const label of ['발견', '혜택', '내 일 등록', '운영확인', '공개', '다시 발견']) {
    await expect(page.locator('.cycle-step').filter({ hasText: label })).toBeVisible();
  }
  await expect(page.locator('.ending-metrics article').nth(0)).toContainText(`${after}개`);
  await expect(page.locator('.ending-metrics article').nth(1)).toContainText('1건');
  await expect(page.locator('.ending-metrics article').nth(2)).toContainText('1건');
  await expect(page.getByText('시연용 예시')).toHaveCount(4);
  await expectNoBlockingA11yViolations(page, 'Scene 08 living economy ending');
});

const endingViewports = [
  { width: 1440, height: 1100 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
  { width: 320, height: 720 }
];

test('Scene 08 ending has no horizontal overflow at the eight field-demo widths', async ({ page }) => {
  for (const viewport of endingViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/ending.html');
    await expect(page.getByRole('heading', { name: /우리 단지의 소비가/ })).toBeVisible();
    const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(sizes.scrollWidth, `${viewport.width}x${viewport.height} overflow`).toBe(sizes.innerWidth);
  }
});
