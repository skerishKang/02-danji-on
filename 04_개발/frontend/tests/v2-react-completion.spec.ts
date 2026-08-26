import { expect, test } from '@playwright/test';

test.describe('Sibling Gate1 React completion', () => {
  test('launch → onboarding → family flow is real React UI without claiming resident verification', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /우리 아파트에/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '오늘, 우리 단지에서 볼 것' })).toBeVisible();

    await page.getByRole('button', { name: /가입하고 시작하기/ }).click();
    const onboarding = page.locator('[data-v2-onboarding]');
    await expect(onboarding).toBeVisible();
    await expect(onboarding).toHaveAttribute('data-phase', 'join');
    await expect(onboarding).toHaveAttribute('data-step', '1');
    await expect(onboarding.getByRole('heading', { name: '어떻게 시작할까요?' })).toBeVisible();
    await expect(onboarding.getByRole('button', { name: /휴대전화로 시작하기/ })).toHaveAttribute('aria-pressed', 'true');

    await onboarding.getByRole('button', { name: '다음', exact: true }).click();
    await expect(onboarding).toHaveAttribute('data-step', '2');
    const optionalConsents = onboarding.locator('input[type="checkbox"]');
    await expect(optionalConsents).toHaveCount(2);
    await expect(optionalConsents.nth(0)).not.toBeChecked();
    await expect(optionalConsents.nth(1)).not.toBeChecked();

    await onboarding.getByRole('button', { name: '필수항목 동의하고 다음' }).click();
    await expect(onboarding).toHaveAttribute('data-step', '3');
    const unitInput = onboarding.locator('input[inputmode="numeric"]');
    await unitInput.fill('1702');
    await onboarding.getByRole('button', { name: '동·호 입력 완료' }).click();

    await expect(onboarding).toHaveAttribute('data-step', '4');
    await expect(onboarding.getByText('입주민 확인 전', { exact: true })).toBeVisible();
    await expect(onboarding.getByText(/실제 주민 확인은 Neon 인증·DB 연결 단계에서 구현합니다/)).toBeVisible();

    await onboarding.getByRole('button', { name: '가족초대로 이동' }).click();
    await expect(onboarding).toHaveAttribute('data-phase', 'family');
    await expect(onboarding).toHaveAttribute('data-step', '1');
    await expect(onboarding.getByText(/우리집 가족도/)).toBeVisible();

    await onboarding.getByRole('button', { name: '나중에 하기' }).click();
    await expect(onboarding).toHaveCount(0);
  });

  test('project story is a React surface, not a separate HTML runtime', async ({ page }) => {
    await page.goto('/');
    const home = page.locator('#v2-resident-home');
    await home.getByRole('button', { name: '단지온 도입과 운영' }).click();
    await expect(page.getByRole('heading', { name: /같은 단지에 사는 이웃을/ })).toBeVisible();
    await expect(page.getByText('PADIEM', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(page.getByRole('heading', { name: /같은 단지에 사는 이웃을/ })).toHaveCount(0);
  });

  test('resident home quick actions remain frontend-only navigation', async ({ page }) => {
    await page.goto('/');
    const home = page.locator('#v2-resident-home');
    await expect(home.getByRole('heading', { name: '오늘, 우리 단지에서 볼 것' })).toBeVisible();
    await expect(home.getByText('10%', { exact: true })).toBeVisible();
    await expect(home.getByRole('button', { name: /내 일 알리기/ })).toBeVisible();
    await expect(home.getByRole('button', { name: /단지온 도입과 운영/ })).toBeVisible();
  });
});