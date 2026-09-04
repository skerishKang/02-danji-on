import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { V2_REFERENCE, V2_SELECTORS } from './v2/reference-contract';
import {
  activeLongAnimations,
  expectKeyboardFocusVisible,
  expectNoHorizontalOverflow,
  firstVisible,
  openV2,
  tabUntilFocused
} from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('desktop/tablet/mobile layouts preserve the current daily-home intro and no horizontal overflow', async ({ page }, testInfo) => {
  const search = page.getByPlaceholder(V2_REFERENCE.copy.heroSearchPlaceholder);
  await expect(search).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const width = page.viewportSize()!.width;
  const mobileNav = page.locator(V2_SELECTORS.mobileNav.join(',')).first();
  if (width <= 800) {
    await expect(mobileNav).toBeVisible();
    for (const label of ['홈', '이웃가게', '우리단지', '내정보']) {
      await expect(mobileNav.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(mobileNav.getByRole('button', { name: '혜택', exact: true })).toHaveCount(0);
  } else {
    await expect(mobileNav).toBeHidden();
  }

  const hero = await firstVisible(page, V2_SELECTORS.hero, 'current daily-home intro');
  const heroBox = await hero.boundingBox();
  expect(heroBox).not.toBeNull();
  expect(heroBox!.height).toBeLessThan((page.viewportSize()?.height ?? 1000) * 0.6);

  const stage = await firstVisible(page, V2_SELECTORS.cinematicStage, 'cinematic stage');
  const position = await stage.evaluate((element) => getComputedStyle(element).position);
  expect(position).not.toBe('sticky');

  if (testInfo.project.name === 'mobile-390' || testInfo.project.name === 'mobile-320') {
    const visual = page.locator('[data-v2-section="cinematic"] .v2-scene-visual');
    const visualBox = await visual.boundingBox();
    expect(visualBox).not.toBeNull();
    expect(visualBox!.height).toBeGreaterThanOrEqual(295);
    expect(visualBox!.height).toBeLessThanOrEqual(305);
  }
});

test('keyboard navigation exposes visible focus and scene tabs support arrow keys', async ({ page }) => {
  const search = page.getByPlaceholder(V2_REFERENCE.copy.heroSearchPlaceholder);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await tabUntilFocused(page, search, 14);
  await expect(search).toBeFocused();
  await expectKeyboardFocusVisible(search);

  const firstScene = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[0].tabName) });
  const secondScene = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[1].tabName) });
  await firstScene.scrollIntoViewIfNeeded();
  await firstScene.focus();
  await expectKeyboardFocusVisible(firstScene);
  await page.keyboard.press('ArrowRight');
  await expect(secondScene).toBeFocused();
  await expect(secondScene).toHaveAttribute('aria-pressed', 'true');

  const detail = page.getByRole('button', { name: /^(이 이웃의 일 보기|상세보기)$/ }).first();
  await detail.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeFocused();
});

test('V2 has no serious or critical automated accessibility violations on the main surface', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join('\n')).toEqual([]);
});

test('prefers-reduced-motion removes long cinematic animation without breaking scene selection', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openV2(page);
  await page.waitForTimeout(120);

  const longAnimations = await activeLongAnimations(page, 100);
  expect(longAnimations, `reduced-motion still has long animations: ${JSON.stringify(longAnimations)}`).toEqual([]);

  const stage = await firstVisible(page, V2_SELECTORS.cinematicStage, 'reduced-motion cinematic stage');
  const position = await stage.evaluate((element) => getComputedStyle(element).position);
  expect(position).not.toBe('sticky');

  for (const selector of V2_SELECTORS.topProgress) {
    const progress = page.locator(selector).first();
    if ((await progress.count()) > 0) {
      const display = await progress.evaluate((element) => getComputedStyle(element).display);
      expect(display).toBe('none');
      break;
    }
  }

  const secondScene = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[1].tabName) });
  await secondScene.click();
  await expect(page.getByRole('heading', { name: V2_REFERENCE.scenes[1].heading })).toBeVisible();
  await expect(page.getByText('모션 줄이기', { exact: true })).toBeAttached();
});
