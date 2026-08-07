import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test('resident verification screen has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/verification.html');
  await expect(page.getByRole('heading', { name: '입주민 인증' })).toBeVisible();
  await expectNoBlockingA11yViolations(page, 'resident verification');
});

test('resident verification operations screen has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/verification-admin.html');
  await expect(page.getByRole('heading', { name: '입주민 인증 관리' })).toBeVisible();
  await expectNoBlockingA11yViolations(page, 'resident verification operations');
});
