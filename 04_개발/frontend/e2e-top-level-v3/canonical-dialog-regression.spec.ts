import { expect, test } from '@playwright/test';

const shopPath = '/01_이웃가게_발견.html';
const couponPath = '/03_주민혜택_쿠폰.html?review=1';

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1000 }
]) {
  test.describe(`canonical dialog regression (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('nested inquiry repeats with focus, inert, and escape restoration', async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', error => pageErrors.push(error));

      await page.goto(shopPath);
      const card = page.locator('[data-shop-key="florist"]');
      await card.scrollIntoViewIfNeeded();
      await card.click();
      const parent = page.locator('#shopCompareModal');
      await expect(parent).toHaveClass(/open/);

      for (let i = 0; i < 8; i += 1) {
        const trigger = page.locator('#shopCompareInquiry');
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const child = page.locator('#shopInquiryModal');
        await expect(child).toHaveClass(/open/);
        await expect.poll(() => child.evaluate((node: HTMLElement) => node.inert)).toBe(false);
        await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('shopInquiryClose');
        await page.keyboard.press('Escape');
        await expect(child).not.toHaveClass(/open/);
        await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('shopCompareInquiry');
      }

      expect(pageErrors).toHaveLength(0);
    });

    test('closed coupon sheet is inert and gallery uses image properties', async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', error => pageErrors.push(error));

      await page.goto(couponPath);
      const sheet = page.locator('.sheet-backdrop');
      await expect(sheet).toHaveAttribute('aria-hidden', 'true');
      await expect.poll(() => sheet.evaluate((node: HTMLElement) => node.inert)).toBe(true);
      await page.locator('.coupon-open').click();
      await expect(sheet).toHaveClass(/open/);
      await expect.poll(() => sheet.evaluate((node: HTMLElement) => node.inert)).toBe(false);
      await page.locator('.sheet-close').click();
      await expect(sheet).not.toHaveClass(/open/);
      await expect.poll(() => sheet.evaluate((node: HTMLElement) => node.inert)).toBe(true);

      await page.goto(shopPath);
      const card = page.locator('[data-shop-key="florist"]');
      await card.scrollIntoViewIfNeeded();
      await card.click();
      await expect(page.locator('#shopCompareGallery img')).toHaveCount(3);
      await expect(page.locator('#shopCompareGallery img').first()).toHaveAttribute('src', 'assets/home-florist.png');
      expect(pageErrors).toHaveLength(0);
    });
  });
}
