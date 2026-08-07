import { expect, test } from '@playwright/test';

test('home replaces the old emoji hero with verified working-scene photography', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /필요한 일/ })).toBeVisible();
  await expect(page.locator('.hero-scene')).toHaveCount(0);
  await expect(page.locator('.scene-people')).toHaveCount(0);
  await expect(page.locator('.cinematic-sprite')).toBeVisible();
  await expect(page.getByRole('tablist', { name: '이웃 작업 장면' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);

  const spriteResponse = await page.request.get('/field-demo/scenes-sprite.jpg');
  expect(spriteResponse.ok()).toBeTruthy();
});

test('four scene tabs change the actual working context without automatic rotation', async ({ page }) => {
  await page.goto('/');

  const food = page.getByRole('tab', { name: '반찬·먹거리' });
  const learning = page.getByRole('tab', { name: '과외·수업' });
  const homeCare = page.getByRole('tab', { name: '생활수리' });
  const professional = page.getByRole('tab', { name: '상담·전문' });

  await expect(food).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 3, name: /오늘 필요한 반찬/ })).toBeVisible();

  await learning.click();
  await expect(learning).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 3, name: /이웃의 전문성을 발견합니다/ })).toBeVisible();

  await homeCare.click();
  await expect(homeCare).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 3, name: /우리 동네에서 빠르게/ })).toBeVisible();

  await professional.click();
  await expect(professional).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 3, name: /가까운 연결부터/ })).toBeVisible();

  await page.waitForTimeout(700);
  await expect(professional).toHaveAttribute('aria-selected', 'true');
});

test('cinematic CTA enters the real four-step registration flow', async ({ page }) => {
  await page.goto('/');
  await page.locator('.cinematic-actions').getByRole('button', { name: '내 일 알리기' }).click();
  await expect(page.getByText('STEP 1 / 4')).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 일을 4단계로 알려주세요' })).toBeVisible();
});

test('reduced motion disables cinematic image entrance animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const animationName = await page.locator('.cinematic-sprite').evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe('none');
});
