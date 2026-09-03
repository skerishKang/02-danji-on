import { expect, test } from '@playwright/test';

test('operator reviews and publishes resident-news without exposing residence data', async ({ page }) => {
  await page.goto('/admin.html');
  await page.getByRole('button', { name: '주민소식 검토' }).click();

  const card = page.locator('.resident-news-review-card').filter({ hasText: '어린이 놀이터 그늘막 점검 요청' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('놀이터지킴이');
  await expect(card).not.toContainText(/동\s*·?\s*호|세대코드|인증서류|proof/i);

  await card.getByLabel('운영자 검토 메모 - 어린이 놀이터 그늘막 점검 요청').fill('현장 확인 후 주민 안내로 게시');
  await card.getByRole('button', { name: '검토 시작' }).click();
  await expect(page.getByText(/검토 중으로 변경했습니다/)).toBeVisible();
  await expect(card).toHaveCount(0);

  await page.getByLabel('주민소식 검토 상태 필터').selectOption('reviewing');
  const reviewingCard = page.locator('.resident-news-review-card').filter({ hasText: '어린이 놀이터 그늘막 점검 요청' });
  await expect(reviewingCard).toBeVisible();
  await reviewingCard.getByLabel('게시 제목 - 어린이 놀이터 그늘막 점검 요청').fill('어린이 놀이터 그늘막 점검 안내');
  await reviewingCard.getByLabel('게시 내용 - 어린이 놀이터 그늘막 점검 요청').fill('놀이터 그늘막 상태를 확인하고 시설 점검 요청을 전달했습니다.');
  await reviewingCard.getByRole('button', { name: '승인·게시' }).click();
  await expect(page.getByText(/승인·게시했습니다/)).toBeVisible();
  await expect(reviewingCard).toHaveCount(0);

  await page.getByLabel('주민소식 검토 상태 필터').selectOption('approved');
  const approvedCard = page.locator('.resident-news-review-card').filter({ hasText: '어린이 놀이터 그늘막 점검 요청' });
  await expect(approvedCard).toBeVisible();
  await expect(approvedCard).toContainText('승인·게시');
  await expect(approvedCard).toContainText('주민 전용 주민소식으로 게시 완료');
});
