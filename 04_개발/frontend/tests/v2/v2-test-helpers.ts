import { expect, type Locator, type Page } from '@playwright/test';
import { V2_SELECTORS } from './reference-contract';

export async function firstVisible(page: Page, selectors: readonly string[], label: string): Promise<Locator> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) return locator;
  }
  throw new Error(`V2 parity element not found or visible: ${label} (${selectors.join(', ')})`);
}

export async function openV2(page: Page): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response, 'V2 navigation must return a response').not.toBeNull();
  expect(response!.status(), 'V2 root must not return a 5xx response').toBeLessThan(500);
  await expect(page.locator(V2_SELECTORS.root), 'V2 build must expose data-ui-variant="v2"').toBeVisible();
  await expect(page.getByText('V2 화면 통합 대기 중'), 'Track C pending surface is not a fidelity PASS').toHaveCount(0);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(metrics.documentWidth, `document overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.bodyWidth, `body overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
}

export async function expectInsideFirstViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'element must have a layout box').not.toBeNull();
  expect(viewport, 'viewport must be configured').not.toBeNull();
  expect(box!.y, 'first-screen element must start before viewport bottom').toBeLessThan(viewport!.height);
  expect(box!.y + box!.height, 'first-screen element must be fully visible without scrolling').toBeLessThanOrEqual(viewport!.height + 4);
}

export async function expectKeyboardFocusVisible(locator: Locator): Promise<void> {
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
      boxShadow: style.boxShadow
    };
  });
  const visible = (focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth >= 2) || focusStyle.boxShadow !== 'none';
  expect(visible, `focused control needs a visible focus indicator: ${JSON.stringify(focusStyle)}`).toBe(true);
}

export async function tabUntilFocused(page: Page, locator: Locator, maxTabs = 16): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Could not reach target with keyboard Tab within ${maxTabs} steps.`);
}

export async function activeLongAnimations(page: Page, thresholdMs = 100): Promise<Array<{ duration: number; target: string }>> {
  return page.evaluate((threshold) => {
    return document.getAnimations().flatMap((animation) => {
      const timing = animation.effect?.getComputedTiming();
      const raw = timing?.duration;
      const duration = typeof raw === 'number' ? raw : Number(raw || 0);
      if (!Number.isFinite(duration) || duration <= threshold) return [];
      const target = animation.effect && 'target' in animation.effect
        ? (animation.effect.target as Element | null)
        : null;
      return [{
        duration,
        target: target instanceof Element
          ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${target.className ? `.${String(target.className).replace(/\s+/g, '.')}` : ''}`
          : 'unknown'
      }];
    });
  }, thresholdMs);
}
