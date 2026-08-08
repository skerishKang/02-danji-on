import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const APPLICATION_STORE_KEY = 'danjion.mock.business-applications.v1';

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function registerHangyeol(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), APPLICATION_STORE_KEY);
  await page.reload();

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

test('scene 07 separates public/private review, approves, increments published count and returns to resident discovery', async ({ page }) => {
  await registerHangyeol(page);

  const residentApplication = page.locator('.application-item').filter({ hasText: '한결수학' });
  await residentApplication.getByRole('link', { name: '한결수학 홍보물 만들기' }).click();
  await page.getByRole('button', { name: '홍보물 만들기' }).click();
  await expect(page.locator('.promo-output.is-built')).toHaveCount(3);

  await page.goto('/admin.html');
  const adminCard = page.locator('.admin-application-card').filter({ hasText: '한결수학' });
  await expect(adminCard).toBeVisible();
  const reviewLink = adminCard.getByRole('link', { name: '한결수학 운영확인' });
  await expect(reviewLink).toBeVisible();
  await reviewLink.click();

  await expect(page).toHaveURL(/\/operations-review\.html\?application=mock-app-/);
  await expect(page.getByRole('heading', { name: /공개할 정보와/ })).toBeVisible();
  await expect(page.locator('.review-public-panel')).toContainText('한결수학');
  await expect(page.locator('.review-public-panel')).toContainText('중·고등학생 수학 과외');
  await expect(page.locator('.review-public-panel')).toContainText('방림명지로드힐 학생 첫 수업 무료');
  await expect(page.locator('.review-private-panel')).toContainText('현재 단지 주민 직접 운영');
  await expect(page.locator('.review-private-panel')).toContainText('확인자료 1건');
  await expect(page.locator('.review-private-panel')).toContainText('동·호수, 증빙 이미지, 원문 object key는 review-context 응답에 포함하지 않습니다.');
  await expect(page.locator('.review-private-panel')).not.toContainText('101동');
  await expect(page.locator('.review-private-panel')).not.toContainText('1204호');
  await expectNoBlockingA11yViolations(page, 'operations review before approval');

  await page.getByRole('button', { name: '승인하여 공개' }).click();
  await expect(page.getByText('한결수학이 주민에게 공개됐습니다.')).toBeVisible();
  await expect(page.getByText('승인·공개')).toBeVisible();

  const countText = await page.locator('.published-count strong').textContent();
  const match = countText?.match(/(\d+)\s*→\s*(\d+)/);
  expect(match, `expected published count transition, received: ${countText}`).not.toBeNull();
  const before = Number(match?.[1]);
  const after = Number(match?.[2]);
  expect(after).toBe(before + 1);
  await expect(page.locator('.published-count')).toContainText('+1 공개');
  await expectNoBlockingA11yViolations(page, 'operations review after approval');

  await page.getByRole('link', { name: '주민 공개목록에서 확인' }).click();
  await expect(page).toHaveURL(/\?view=listings&businessName=/);
  await expect(page.getByRole('heading', { name: '가게와 서비스' })).toBeVisible();
  const highlighted = page.locator('.service-card.deep-link-highlight').filter({ hasText: '한결수학' });
  await expect(highlighted).toBeVisible();
  await expect(page.locator('.result-summary strong')).toHaveText(`${after}개의 가게와 서비스`);
});

test('already approved application cannot be approved again from scene 07', async ({ page }) => {
  await registerHangyeol(page);
  await page.goto('/admin.html');
  const adminCard = page.locator('.admin-application-card').filter({ hasText: '한결수학' });
  await adminCard.getByRole('link', { name: '한결수학 운영확인' }).click();
  await page.getByRole('button', { name: '승인하여 공개' }).click();
  await expect(page.getByText('한결수학이 주민에게 공개됐습니다.')).toBeVisible();

  await page.reload();
  await expect(page.getByText('한결수학이 주민에게 공개됐습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '승인하여 공개' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '주민 공개목록에서 확인' })).toBeVisible();
});
