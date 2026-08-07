import { expect, test } from '@playwright/test';

const STORE_KEY = 'danjion.mock.resident-verifications.v1';

async function seedUnverifiedResident(page: import('@playwright/test').Page) {
  await page.goto('/verification.html');
  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify([
      {
        id: null,
        membershipId: 'mock-membership-resident-001',
        subject: 'dev-resident-001',
        displayName: '온이웃',
        complexSlug: 'bangnim-myeongji-roadhill',
        complexName: '방림명지로드힐',
        status: 'unverified'
      }
    ]));
  }, STORE_KEY);
  await page.reload();
}

test('resident verification moves from unverified to pending to verified', async ({ page }) => {
  await seedUnverifiedResident(page);

  await expect(page.locator('.verification-status')).toContainText('미인증');
  await page.getByLabel('동 *').fill('102');
  await page.getByLabel('호수 *').fill('1202');
  await page.getByLabel('인증 방법').selectOption('management_confirmation');
  await page.getByRole('button', { name: '입주민 인증 신청' }).click();
  await expect(page.locator('.verification-status')).toContainText('확인 대기');
  await expect(page.getByText('102')).toBeVisible();
  await expect(page.getByText('1202')).toBeVisible();

  await page.goto('/verification-admin.html');
  const card = page.locator('.verification-review-card').filter({ hasText: '온이웃' });
  await expect(card).toBeVisible();
  await expect(card.locator('.verification-badge.pending')).toHaveText('확인 대기');
  await card.getByRole('button', { name: '인증 승인' }).click();
  await expect(page.getByText("온이웃님의 입주민 인증을 '인증 완료' 처리했습니다.")).toBeVisible();

  await page.goto('/verification.html');
  await expect(page.locator('.verification-status')).toContainText('인증 완료');
  await expect(page.getByText('인증 주민에게만 공개되는 연락처와 주민 전용 기능을 사용할 수 있습니다.')).toBeVisible();
});

test('rejected resident can correct details and reapply', async ({ page }) => {
  await seedUnverifiedResident(page);
  await page.getByLabel('동 *').fill('102');
  await page.getByLabel('호수 *').fill('9999');
  await page.getByRole('button', { name: '입주민 인증 신청' }).click();

  await page.goto('/verification-admin.html');
  const card = page.locator('.verification-review-card').filter({ hasText: '온이웃' });
  await card.getByLabel('검토 메모').fill('호수를 다시 확인해 주세요.');
  await card.getByRole('button', { name: '반려' }).click();

  await page.goto('/verification.html');
  await expect(page.locator('.verification-status')).toContainText('반려');
  await expect(page.getByText('호수를 다시 확인해 주세요.')).toBeVisible();
  await page.getByLabel('호수 *').fill('1202');
  await page.getByRole('button', { name: '다시 인증 신청' }).click();
  await expect(page.locator('.verification-status')).toContainText('확인 대기');
});
