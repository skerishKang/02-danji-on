import { expect, test } from '@playwright/test';
import { V2_REFERENCE, V2_SELECTORS } from './v2/reference-contract';
import { expectInsideFirstViewport, firstVisible, openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('V2 keeps the fixed editorial topbar and first-screen hero/search composition', async ({ page }, testInfo) => {
  const topbar = await firstVisible(page, V2_SELECTORS.topbar, 'fixed editorial topbar');
  await expect(page.getByText('단지온').first()).toBeVisible();
  const topbarPosition = await topbar.evaluate((element) => getComputedStyle(element).position);
  expect(topbarPosition).toBe('fixed');

  await expect(page.getByRole('heading', { name: V2_REFERENCE.copy.heroHeading })).toBeVisible();
  const search = page.getByPlaceholder(new RegExp(V2_REFERENCE.copy.heroSearchPlaceholder));
  await expect(search).toBeVisible();
  await expectInsideFirstViewport(page, search);

  const heroImage = await firstVisible(page, V2_SELECTORS.heroImage, 'real-photo hero image');
  const imageState = await heroImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.currentSrc || image.src };
  });
  expect(imageState.naturalWidth).toBeGreaterThan(300);
  expect(imageState.naturalHeight).toBeGreaterThan(200);
  expect(imageState.src).toBeTruthy();

  if (testInfo.project.name === 'desktop-1440') {
    const hero = await firstVisible(page, V2_SELECTORS.hero, 'hero section');
    const heroBox = await hero.boundingBox();
    const imageBox = await heroImage.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(imageBox).not.toBeNull();
    expect(imageBox!.width).toBeGreaterThan(heroBox!.width * 0.38);
  }
});

test('V2 cinematic system preserves four scene buttons, keyboard selection and category color change without scroll trapping', async ({ page }, testInfo) => {
  const cinematic = await firstVisible(page, V2_SELECTORS.cinematic, 'cinematic scene system');
  await cinematic.scrollIntoViewIfNeeded();

  const firstTab = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[0].tabName) });
  const secondTab = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[1].tabName) });
  const thirdTab = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[2].tabName) });
  const fourthTab = page.getByRole('button', { name: new RegExp(V2_REFERENCE.scenes[3].tabName) });
  for (const tab of [firstTab, secondTab, thirdTab, fourthTab]) await expect(tab).toBeVisible();

  await expect(page.getByRole('heading', { name: V2_REFERENCE.scenes[0].heading })).toBeVisible();
  const panel = await firstVisible(page, V2_SELECTORS.cinematicPanel, 'cinematic information panel');
  const before = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);

  await secondTab.click();
  await expect(secondTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: V2_REFERENCE.scenes[1].heading })).toBeVisible();
  await expect(page.getByText(V2_REFERENCE.scenes[1].service).first()).toBeVisible();
  const after = await panel.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(after).not.toBe(before);

  await secondTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(thirdTab).toBeFocused();
  await expect(thirdTab).toHaveAttribute('aria-pressed', 'true');

  const stage = await firstVisible(page, V2_SELECTORS.cinematicStage, 'cinematic stage');
  const stagePosition = await stage.evaluate((element) => getComputedStyle(element).position);
  if (testInfo.project.name === 'desktop-1440' || testInfo.project.name === 'tablet-1024') {
    expect(stagePosition).toBe('sticky');
    const worldBox = await cinematic.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 1000;
    expect(worldBox).not.toBeNull();
    expect(worldBox!.height).toBeLessThanOrEqual(viewportHeight * 1.05);
  } else {
    expect(stagePosition).not.toBe('sticky');
  }
});

test('V2 preserves the source section order from discovery through circular-economy ending', async ({ page }) => {
  const anchors = [
    { locator: page.getByRole('heading', { name: V2_REFERENCE.copy.discoveryHeading }), label: 'discovery' },
    { locator: page.getByRole('heading', { name: V2_REFERENCE.copy.benefitHeading }), label: 'benefits' },
    { locator: page.getByRole('heading', { name: V2_REFERENCE.copy.registrationHeading }), label: 'registration' },
    { locator: page.getByRole('heading', { name: V2_REFERENCE.copy.promoHeading }), label: 'promo' },
    { locator: page.getByRole('heading', { name: V2_REFERENCE.copy.endingHeading }), label: 'ending' }
  ];

  const yPositions: number[] = [];
  for (const anchor of anchors) {
    await expect(anchor.locator, `${anchor.label} heading must exist`).toBeVisible();
    const y = await anchor.locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    yPositions.push(y);
  }
  expect(yPositions).toEqual([...yPositions].sort((a, b) => a - b));
});
