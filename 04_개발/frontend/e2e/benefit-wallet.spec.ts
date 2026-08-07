import { expect, test } from '@playwright/test';

const BENEFIT_WALLET_KEY = 'danjion.mock.benefit-wallet.v1';

async function resetBenefitWallet(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), BENEFIT_WALLET_KEY);
  await page.reload();
}

test('resident claims a benefit, stores its code, and marks it used from My Info', async ({ page }) => {
  await resetBenefitWallet(page);

  await page.getByRole('button', { name: '주민혜택' }).first().click();
  const card = page.locator('.benefit-wallet-card').filter({ hasText: '첫 방문 10% 할인' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: '주민혜택 받기' })).toBeVisible();

  await card.getByRole('button', { name: '주민혜택 받기' }).click();
  await expect(card.getByText('DANJION-0248 · 보관 중')).toBeVisible();
  await expect(card.getByText(/내정보에 보관했습니다/)).toBeVisible();

  await page.getByRole('button', { name: '내정보' }).first().click();
  const walletItem = page.locator('.my-benefit-item').filter({ hasText: '첫 방문 10% 할인' });
  await expect(walletItem).toBeVisible();
  await expect(walletItem.getByText('DANJION-0248')).toBeVisible();
  await expect(walletItem.getByText('보관 중')).toBeVisible();

  await walletItem.getByRole('button', { name: '사용 완료 처리' }).click();
  await expect(walletItem.getByText('사용 완료')).toBeVisible();
  await expect(walletItem.getByRole('button', { name: '사용 완료 처리' })).toHaveCount(0);

  await page.getByRole('button', { name: '주민혜택' }).first().click();
  const usedCard = page.locator('.benefit-wallet-card').filter({ hasText: '첫 방문 10% 할인' });
  await expect(usedCard.getByText('DANJION-0248 · 사용 완료')).toBeVisible();
  await expect(usedCard.getByRole('button', { name: '사용 완료됨' })).toBeDisabled();
});

test('claim action is idempotent and does not create duplicate wallet entries', async ({ page }) => {
  await resetBenefitWallet(page);

  await page.getByRole('button', { name: '주민혜택' }).first().click();
  const card = page.locator('.benefit-wallet-card').filter({ hasText: '출장비 무료' });
  await card.getByRole('button', { name: '주민혜택 받기' }).click();

  await page.getByRole('button', { name: '내정보' }).first().click();
  await expect(page.locator('.my-benefit-item').filter({ hasText: '출장비 무료' })).toHaveCount(1);

  await page.reload();
  await expect(page.locator('.my-benefit-item').filter({ hasText: '출장비 무료' })).toHaveCount(1);
});

test('business detail reflects stored benefit state', async ({ page }) => {
  await resetBenefitWallet(page);

  await page.getByRole('button', { name: '주민혜택' }).first().click();
  const card = page.locator('.benefit-wallet-card').filter({ hasText: '주민 첫 상담 무료' });
  await card.getByRole('button', { name: '주민혜택 받기' }).click();
  await card.getByRole('button', { name: '이음 세무상담' }).click();

  await expect(page.getByRole('heading', { name: '이음 세무상담' })).toBeVisible();
  await expect(page.locator('.detail-benefit-wallet').getByText(/DANJION-\d{4} · 보관 중/)).toBeVisible();
  await expect(page.locator('.detail-benefit-wallet').getByRole('button', { name: '사용 완료 처리' })).toBeVisible();
});
