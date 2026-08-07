import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const APPLICATION_STORE_KEY = 'danjion.mock.business-applications.v1';

async function resetApplications(page: Page) {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), APPLICATION_STORE_KEY);
  await page.reload();
}

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test('new resident application becomes three promo materials using its uploaded representative image', async ({ page }) => {
  await resetApplications(page);

  await page.getByRole('button', { name: '내 일 알리기', exact: true }).click();
  await expect(page.getByText('STEP 1 / 4')).toBeVisible();
  await page.getByRole('button', { name: '다음 단계' }).click();

  await page.getByLabel('가게·서비스명 *').fill('한결수학');
  await page.getByLabel('분야 *').fill('과외·수업');
  await page.getByLabel('한 줄 소개 *').fill('중·고등학생 수학 과외');
  await page.getByLabel('가격').fill('중등 수학 월 18만원부터');
  await page.getByLabel('이용 지역').fill('방림명지로드힐과 인근 지역');
  await page.getByRole('button', { name: '다음 단계' }).click();

  await page.getByLabel('입주민 혜택').fill('방림명지로드힐 학생 첫 수업 무료');
  await page.locator('.image-picker input[type="file"]').setInputFiles({
    name: 'hangyeol-math.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  });
  await expect(page.locator('.image-preview img')).toBeVisible();
  await page.getByRole('button', { name: '다음 단계' }).click();

  await expect(page.getByText('주민에게 공개')).toBeVisible();
  await expect(page.getByText('운영 확인 · 일반 공개 안 함')).toBeVisible();
  await page.getByRole('button', { name: '등록 신청 완료' }).click();

  const application = page.locator('.application-item').filter({ hasText: '한결수학' });
  await expect(application).toBeVisible();
  const promoLink = application.getByRole('link', { name: '한결수학 홍보물 만들기' });
  await expect(promoLink).toBeVisible();
  await promoLink.click();

  await expect(page).toHaveURL(/\/promo\.html\?application=mock-app-/);
  await expect(page.getByRole('heading', { name: /입력한 생활정보가/ })).toBeVisible();
  await expect(page.getByText('한결수학 · 등록 대기')).toBeVisible();
  await expect(page.getByText('등록 사진 연결됨')).toBeVisible();
  await expect(page.locator('.promo-output.is-waiting')).toHaveCount(3);

  await page.getByRole('button', { name: '홍보물 만들기' }).click();
  await expect(page.locator('.promo-output.is-built')).toHaveCount(3);
  await expect(page.locator('.promo-photo-image')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: '단지온 가게소개 카드' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '카카오톡 공유 이미지' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '엘리베이터 게시판 포스터' })).toBeVisible();
  await expect(page.getByText('방림명지로드힐 학생 첫 수업 무료')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '홍보물 3종 완성' })).toBeDisabled();
  await expectNoBlockingA11yViolations(page, 'promo materials built state');
});

test('pending application without uploaded image uses a real working-scene fallback instead of emoji artwork', async ({ page }) => {
  await resetApplications(page);
  await page.getByRole('button', { name: '내정보' }).first().click();

  const application = page.locator('.application-item').filter({ hasText: '정성 홈베이킹' });
  const promoLink = application.getByRole('link', { name: '정성 홈베이킹 홍보물 만들기' });
  await expect(promoLink).toBeVisible();
  await promoLink.click();

  await expect(page.getByText('기본 작업장면 사용')).toBeVisible();
  await page.getByRole('button', { name: '홍보물 만들기' }).click();
  await expect(page.locator('.promo-output.is-built')).toHaveCount(3);
  await expect(page.locator('.promo-photo-fallback')).toHaveCount(3);
  await expect(page.locator('.promo-photo-fallback.scene-food')).toHaveCount(3);
  await expect(page.locator('.promo-artwork').filter({ hasText: '🤖' })).toHaveCount(0);
  await expect(page.locator('.promo-artwork').filter({ hasText: '✨' })).toHaveCount(0);
});
