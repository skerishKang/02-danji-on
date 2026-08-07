import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoBlockingA11yViolations(page: Page, context: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${context} accessibility violations:\n${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test('resident primary screens have no serious or critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expectNoBlockingA11yViolations(page, 'resident home');

  await page.getByRole('button', { name: '가게·서비스' }).first().click();
  await expect(page.getByRole('heading', { name: '가게와 서비스' })).toBeVisible();
  await expectNoBlockingA11yViolations(page, 'resident listings');

  await page.locator('.service-card').first().locator('.service-copy').click();
  await expect(page.locator('.detail-page')).toBeVisible();
  await expectNoBlockingA11yViolations(page, 'resident detail');

  await page.goto('/');
  await page.getByRole('button', { name: '내정보' }).first().click();
  await expectNoBlockingA11yViolations(page, 'resident my');
});

test('operations primary screens have no serious or critical axe violations', async ({ page }) => {
  await page.goto('/admin.html');
  await expectNoBlockingA11yViolations(page, 'operations applications');

  await page.getByRole('button', { name: '검토 이력' }).click();
  await expectNoBlockingA11yViolations(page, 'operations audit');

  await page.getByRole('button', { name: '단지소식' }).click();
  await expectNoBlockingA11yViolations(page, 'operations posts');

  await page.getByRole('button', { name: '주민혜택' }).click();
  await expectNoBlockingA11yViolations(page, 'operations benefits');
});
