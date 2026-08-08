import { expect, test, type Locator } from '@playwright/test';
import { openV2 } from './v2/v2-test-helpers';

function parseRgb(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function luminance([r, g, b]: readonly number[]) {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function expectReadableContrast(locator: Locator, minimum = 4.5) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  const foreground = luminance(parseRgb(colors.color));
  const background = luminance(parseRgb(colors.backgroundColor));
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  expect(ratio, `${colors.color} on ${colors.backgroundColor} contrast ratio`).toBeGreaterThanOrEqual(minimum);
}

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('hero primary CTA and search submit keep readable foreground contrast', async ({ page }) => {
  const primary = page.getByRole('button', { name: /가게와 서비스 찾기/ }).first();
  const searchSubmit = page.getByRole('button', { name: '찾기', exact: true }).first();

  await expect(primary).toBeVisible();
  await expect(searchSubmit).toBeVisible();
  await expectReadableContrast(primary);
  await expectReadableContrast(searchSubmit);
});
