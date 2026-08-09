import { expect, test } from '@playwright/test';

const demoEnabled = process.env.VITE_PREVIEW_DEMO_MODE === 'true';

test('preview role selector and permission guide are absent unless explicitly enabled', async ({ page }) => {
  await page.goto('/');

  if (demoEnabled) {
    const trigger = page.getByRole('button', { name: '권한 보기 · 일반 방문자' });
    await expect(trigger).toBeVisible();
    await expect(page.getByLabel('사용자 역할')).toHaveCount(0);
    await expect(page.getByText('사용자 권한 비교')).toHaveCount(0);

    await trigger.click();
    await expect(page.getByLabel('사용자 역할')).toBeVisible();
    await expect(page.getByText('사용자 권한 비교')).toBeVisible();
    await expect(page.getByText('권한 한눈에 보기')).toBeVisible();
    await expect(page.getByText('공개 탐색')).toBeVisible();
    await expect(page.getByText('문의처')).toBeVisible();
    await expect(page.getByText('주민혜택')).toBeVisible();
    await expect(page.getByText('내 일 등록')).toBeVisible();
    await expect(page.getByText('운영 승인')).toBeVisible();
    await expect(page.getByText('PREVIEW ONLY')).toHaveCount(0);

    await page.getByRole('button', { name: '권한표 닫기' }).click();
    await expect(page.getByLabel('사용자 역할')).toHaveCount(0);
  } else {
    await expect(page.getByRole('button', { name: /권한 보기/ })).toHaveCount(0);
    await expect(page.getByLabel('사용자 역할')).toHaveCount(0);
    await expect(page.getByText('권한 한눈에 보기')).toHaveCount(0);
  }
});
