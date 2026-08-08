import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test('rehearsal console resets dirty mock state to the deterministic baseline', async ({ page }) => {
  await page.goto('/demo.html');
  await page.evaluate(() => {
    localStorage.setItem('danjion.mock.business-applications.v1', JSON.stringify([{ id: 'dirty-app', businessName: '오염 데이터' }]));
    localStorage.setItem('danjion.mock.benefit-wallet.v1', JSON.stringify([{ id: 'dirty-benefit' }]));
    localStorage.setItem('danjion.mock.posts.v1', JSON.stringify([{ id: 'dirty-post' }]));
    localStorage.setItem('danjion.mock.benefits.v1', JSON.stringify([{ id: 'dirty-created-benefit' }]));
    localStorage.setItem('danjion.mock.application-review-events.v1', JSON.stringify([{ id: 'dirty-review' }]));
  });

  await page.getByRole('button', { name: '1. 시연 준비 초기화' }).click();
  await expect(page.getByText('시연 준비 완료')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('시연 데이터를 기준 상태로 초기화했습니다.');

  const baseline = await page.evaluate(() => ({
    applications: JSON.parse(localStorage.getItem('danjion.mock.business-applications.v1') || '[]'),
    benefitWallet: localStorage.getItem('danjion.mock.benefit-wallet.v1'),
    posts: localStorage.getItem('danjion.mock.posts.v1'),
    benefits: localStorage.getItem('danjion.mock.benefits.v1'),
    reviewEvents: localStorage.getItem('danjion.mock.application-review-events.v1'),
    verification: JSON.parse(localStorage.getItem('danjion.mock.resident-verifications.v1') || '[]'),
    session: JSON.parse(localStorage.getItem('danjion.demo.session.v1') || '{}')
  }));

  expect(baseline.applications).toHaveLength(3);
  expect(baseline.applications.map((item: { businessName: string }) => item.businessName)).toEqual([
    '정성 홈베이킹',
    '맑은창 방충망 수리',
    '이웃 영어회화'
  ]);
  expect(baseline.benefitWallet).toBeNull();
  expect(baseline.posts).toBeNull();
  expect(baseline.benefits).toBeNull();
  expect(baseline.reviewEvents).toBeNull();
  expect(baseline.verification.find((item: { subject: string }) => item.subject === 'dev-resident-001')?.status).toBe('verified');
  expect(baseline.session.status).toBe('ready');
  await expectNoBlockingA11yViolations(page, 'rehearsal console ready state');
});

test('running rehearsal restores the last surface after refresh and survives temporary offline mode', async ({ page, context }) => {
  await page.goto('/demo.html');
  await page.getByRole('button', { name: '1. 시연 준비 초기화' }).click();
  await page.getByRole('button', { name: '2. 시연 시작' }).click();
  await expect(page).toHaveURL(/\?demo=1/);

  await page.goto('/promo.html?application=mock-admin-1');
  await expect(page.getByRole('button', { name: '홍보물 만들기' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '홍보물 만들기' })).toBeVisible();

  await page.goto('/demo.html');
  await expect(page.getByText('홍보물 3종', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '마지막 지점으로 복구' })).toBeEnabled();
  await page.getByRole('button', { name: '마지막 지점으로 복구' }).click();
  await expect(page).toHaveURL(/\/promo\.html\?application=mock-admin-1/);
  await expect(page.getByRole('button', { name: '홍보물 만들기' })).toBeVisible();

  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '홍보물 만들기' })).toBeVisible();
  await context.setOffline(false);

  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: '시연 복구 테스트 오류' })));
  await page.goto('/demo.html');
  await expect(page.getByRole('alert')).toContainText('시연 복구 테스트 오류');
  await expect(page.getByText('온라인', { exact: true })).toBeVisible();
  await expectNoBlockingA11yViolations(page, 'rehearsal recovery console');
});
