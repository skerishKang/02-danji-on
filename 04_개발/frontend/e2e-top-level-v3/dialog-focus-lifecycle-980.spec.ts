import { test, expect, type Page } from '@playwright/test';

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  return errors;
}

async function expectStack(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => {
    const focus = (window as typeof window & { DanjionDialogFocus?: { stack(): Element[] } }).DanjionDialogFocus;
    return focus?.stack().length ?? -1;
  })).toBe(count);
}

async function inert(locator: ReturnType<Page['locator']>): Promise<boolean> {
  return locator.evaluate(element => (element as HTMLElement).inert === true);
}

test('#980 landing auth traps focus, suppresses background, restores trigger, and preserves pre-existing inert', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.goto('/index.html?intro=1');

  const trigger = page.locator('[data-auth="login"]').first();
  const preExistingInert = page.locator('.chair-gate');
  await preExistingInert.evaluate(element => { (element as HTMLElement).inert = true; });

  await trigger.click();
  const layer = page.locator('.modal-layer:not([hidden])');
  const dialog = layer.getByRole('dialog');
  const close = page.locator('.modal-close');

  await expect(dialog).toBeVisible();
  await expectStack(page, 1);
  await expect(close).toBeFocused();
  expect(await inert(page.locator('.public-header'))).toBe(true);
  expect(await inert(page.locator('main'))).toBe(true);

  const visibleButtons = dialog.locator('button:visible');
  const last = visibleButtons.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(layer).toBeHidden();
  await expectStack(page, 0);
  await expect(trigger).toBeFocused();
  expect(await inert(page.locator('.public-header'))).toBe(false);
  expect(await inert(preExistingInert)).toBe(true);
  await expect(page.locator('[data-danjion-focus-inert]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('#980 Neighbor Shops keeps only the top nested sheet interactive and restores each parent trigger at 390px', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html');

  const shopTrigger = page.locator('[data-shop-key][tabindex="0"]').first();
  await expect(shopTrigger).toBeVisible();
  await shopTrigger.click();

  const parent = page.locator('#shopCompareModal');
  await expect(parent).toHaveClass(/open/);
  await expectStack(page, 1);
  await expect(page.locator('#shopCompareClose')).toBeFocused();

  const nestedCases = [
    { trigger: '#shopCompareInquiry', layer: '#shopInquiryModal', close: '#shopInquiryClose' },
    { trigger: '#shopCompareBenefitBtn', layer: '#shopCouponModal', close: '#shopCouponClose' },
    { trigger: '#shopReviewOpen2', layer: '#shopReviewWriteModal', close: '#shopReviewWriteClose' },
    { trigger: '#shopReviewOpen', layer: '#shopReviewModal', close: '#shopReviewClose' }
  ];

  for (const item of nestedCases) {
    const nestedTrigger = page.locator(item.trigger);
    await nestedTrigger.click();
    await expect(page.locator(item.layer)).toHaveClass(/open/);
    await expectStack(page, 2);
    expect(await inert(parent)).toBe(true);
    await expect(page.locator(item.close)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator(item.layer)).not.toHaveClass(/open/);
    await expectStack(page, 1);
    expect(await inert(parent)).toBe(false);
    await expect(nestedTrigger).toBeFocused();
  }

  await page.keyboard.press('Escape');
  await expect(parent).not.toHaveClass(/open/);
  await expectStack(page, 0);
  await expect(shopTrigger).toBeFocused();
  await expect(page.locator('[data-danjion-focus-inert]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('#980 Resident Benefits backdrop/Escape restore focus and clean managed inert state', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/03_%EC%A3%BC%EB%AF%BC%ED%98%9C%ED%83%9D_%EC%BF%A0%ED%8F%B0.html');

  const trigger = page.locator('.coupon-open');
  const backdrop = page.locator('.sheet-backdrop');
  const close = page.locator('.sheet-close');

  await trigger.click();
  await expect(backdrop).toHaveClass(/open/);
  await expectStack(page, 1);
  await expect(close).toBeFocused();
  expect(await inert(page.locator('main'))).toBe(true);

  await backdrop.click({ position: { x: 4, y: 4 } });
  await expect(backdrop).not.toHaveClass(/open/);
  await expectStack(page, 0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(backdrop).not.toHaveClass(/open/);
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-danjion-focus-inert]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('#980 Apartment News mobile native dialog restores its invoking story row', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/08_%EC%95%84%ED%8C%8C%ED%8A%B8%EC%86%8C%EC%8B%9D_%EB%AA%A9%EB%A1%9D.html');

  const trigger = page.locator('.news-row[data-story="meeting"]');
  const dialog = page.locator('#storyDialog');
  await trigger.click();

  await expect(dialog).toHaveAttribute('open', '');
  await expectStack(page, 1);
  await expect(page.locator('[data-close-story]').first()).toBeFocused();
  expect(await inert(page.locator('main'))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expectStack(page, 0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('[data-danjion-focus-inert]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
