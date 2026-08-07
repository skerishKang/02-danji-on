import { expect, test } from '@playwright/test';

const APPLICATION_STORE_KEY = 'danjion.mock.business-applications.v1';

async function resetApplications(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), APPLICATION_STORE_KEY);
  await page.reload();
}

test('search presents a clear empty state for no matches', async ({ page }) => {
  await page.goto('/');
  await page.locator('#home-search').fill('존재하지않는서비스-xyz-999');
  await page.getByRole('button', { name: '검색하기' }).click();
  await expect(page.getByText('조건에 맞는 결과가 없습니다.')).toBeVisible();
  await expect(page.locator('.result-summary')).toContainText('0개의 가게와 서비스');
});

test('business application blocks missing required fields', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /내 일 알리기/ }).click();
  await page.getByRole('button', { name: '등록 신청하기' }).click();
  await expect(page.getByRole('alert')).toHaveText('가게·서비스명, 분야, 소개는 필수입니다.');
});

test('business application rejects non-image representative files', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /내 일 알리기/ }).click();
  await page.locator('.image-picker input[type="file"]').setInputFiles({
    name: 'not-an-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image')
  });
  await expect(page.getByRole('alert')).toHaveText('이미지 파일만 업로드할 수 있습니다.');
  await expect(page.locator('.image-preview img')).toHaveCount(0);
});

test('approved application cannot be reviewed twice in operations UI', async ({ page }) => {
  await resetApplications(page);
  await page.goto('/admin.html');
  const card = page.locator('.admin-application-card').filter({ hasText: '정성 홈베이킹' });
  await expect(card.locator('.admin-status.pending')).toHaveText('확인 대기');
  await card.getByRole('button', { name: '승인' }).click();
  await expect(card.locator('.admin-status.approved')).toHaveText('승인');
  await expect(card.getByRole('button', { name: '보완 요청' })).toBeDisabled();
  await expect(card.getByRole('button', { name: '반려' })).toBeDisabled();
  await expect(card.getByRole('button', { name: '승인' })).toBeDisabled();
});
