import { expect, test } from '@playwright/test';

test.describe('Current 04 React completion', () => {
  test('daily home → account entry is real React UI without claiming resident verification', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: '필요한 일, 우리 단지에서 먼저 찾습니다.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '우리단지 새 소식' })).toBeVisible();

    const launcher = page.getByRole('button', { name: '가입·로그인', exact: true });
    const viewportWidth = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
    if (viewportWidth <= 768) {
      await expect(page.locator('[data-v2-mobile-nav]')).toBeVisible();
      await expect(launcher).toHaveCount(0);
      return;
    }

    await expect(launcher).toBeVisible();
    await launcher.click();

    const auth = page.locator('[data-v2-auth-entry]');
    await expect(auth).toBeVisible();
    await expect(auth.getByRole('heading', { name: '단지온 계정을 만들어요.' })).toBeVisible();
    await expect(auth.getByText(/연락처 소유 확인일 뿐 법적 본인확인이나 입주민 인증이 아닙니다/)).toBeVisible();
    await expect(auth.getByRole('button', { name: 'Kakao로 가입', exact: true })).toBeVisible();
    await expect(auth.getByRole('button', { name: 'Naver로 가입', exact: true })).toBeVisible();
    await expect(auth.getByRole('button', { name: 'Google로 가입', exact: true })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(auth).toHaveCount(0);
  });

  test('direct account choices expose verified-signup fields and email/phone login without resident-auth claims', async ({ page }) => {
    await page.goto('/');
    const launcher = page.getByRole('button', { name: '가입·로그인', exact: true });
    const viewportWidth = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
    if (viewportWidth <= 768) {
      await expect(page.locator('[data-v2-mobile-nav]')).toBeVisible();
      await expect(launcher).toHaveCount(0);
      return;
    }

    await launcher.click();
    const auth = page.locator('[data-v2-auth-entry]');

    await expect(auth.getByRole('button', { name: '처음 가입', exact: true })).toHaveClass(/is-active/);
    await expect(auth.getByPlaceholder('단지온에서 사용할 이름')).toBeVisible();
    await expect(auth.getByPlaceholder('name@example.com')).toBeVisible();
    await expect(auth.getByPlaceholder('010-1234-5678')).toBeVisible();
    await expect(auth.getByPlaceholder('000000')).toBeVisible();
    await expect(auth.getByPlaceholder('8자 이상')).toBeVisible();
    await expect(auth.getByRole('button', { name: '인증번호 받기', exact: true })).toBeDisabled();

    await auth.getByRole('button', { name: '이미 회원', exact: true }).click();
    await expect(auth.getByRole('heading', { name: '다시 만나서 반가워요.' })).toBeVisible();
    await expect(auth.getByRole('button', { name: '이메일', exact: true })).toHaveClass(/is-active/);
    await expect(auth.getByPlaceholder('name@example.com')).toBeVisible();
    await expect(auth.getByPlaceholder('8자 이상')).toBeVisible();

    await auth.getByRole('button', { name: '휴대폰 번호', exact: true }).click();
    await expect(auth.getByPlaceholder('010-1234-5678')).toBeVisible();
    await expect(auth.getByText(/계정 로그인과 입주민 권한은 분리되어 있습니다/)).toBeVisible();
  });

  test('current daily-home benefit and news summary remains an integrated React surface', async ({ page }) => {
    await page.goto('/');
    const summary = page.locator('[data-v2-section="home-summary"]');

    await expect(summary).toBeVisible();
    await expect(summary.getByRole('heading', { name: '가게마다 다른 주민혜택을 이웃가게에서 확인하세요.' })).toBeVisible();
    await expect(summary.getByRole('heading', { name: '우리단지 새 소식' })).toBeVisible();
    await expect(summary.getByRole('button', { name: '이웃가게 전체 보기', exact: true })).toBeVisible();
    await expect(summary.getByRole('button', { name: /전체보기/ })).toBeVisible();

    await summary.getByRole('button', { name: '이웃가게 전체 보기', exact: true }).click();
    await expect(page.locator('#v2-discovery')).toBeVisible();
  });

  test('home news action reuses the current community navigation hook', async ({ page }) => {
    await page.goto('/');
    const summary = page.locator('[data-v2-section="home-summary"]');
    const communityButton = summary.getByRole('button', { name: /전체보기/ });
    await expect(communityButton).toBeVisible();
    await communityButton.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await communityButton.click();
    await expect(page.locator('[data-v2-nav-key="community"].is-active').first()).toBeAttached();
  });
});
