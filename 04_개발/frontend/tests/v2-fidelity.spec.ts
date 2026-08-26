import { expect, test } from '@playwright/test';
import { V2_REFERENCE, V2_SELECTORS } from './v2/reference-contract';
import { firstVisible, openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('V2 uses the current sibling Gate1 launch composition on desktop and mobile', async ({ page }, testInfo) => {
  const topbar = await firstVisible(page, V2_SELECTORS.topbar, 'current editorial topbar');
  const topbarPosition = await topbar.evaluate((element) => getComputedStyle(element).position);
  expect(topbarPosition).toBe('fixed');

  const heading = page.getByRole('heading', { name: V2_REFERENCE.copy.heroHeading });
  await expect(heading).toBeVisible();
  await expect(page.getByText('DANJION').first()).toBeVisible();
  await expect(page.getByText('주민이 직접 가입')).toBeVisible();
  await expect(page.getByText('주민명부 제공 없음')).toBeVisible();
  await expect(page.getByText('동·호 비공개')).toBeVisible();

  const hero = await firstVisible(page, V2_SELECTORS.hero, 'current Gate1 hero');
  const heroImage = await firstVisible(page, V2_SELECTORS.heroImage, 'real-photo hero image');
  const imageState = await heroImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.currentSrc || image.src };
  });
  expect(imageState.naturalWidth).toBeGreaterThan(300);
  expect(imageState.naturalHeight).toBeGreaterThan(200);
  expect(imageState.src).toBeTruthy();

  const search = page.getByPlaceholder(new RegExp(V2_REFERENCE.copy.heroSearchPlaceholder));
  await expect(search).toBeVisible();

  // Gate1 deliberately stages search as a separate editorial band after the
  // launch composition. Do not regress to the historical "search must be fully
  // inside the first viewport" contract, especially on tablet/mobile.
  const heroGrid = page.locator('.v2-gate1-hero-grid').first();
  const searchBand = page.locator('.v2-gate1-search-band').first();
  const [heroGridBottom, searchBandTop] = await Promise.all([
    heroGrid.evaluate((element) => element.getBoundingClientRect().bottom + window.scrollY),
    searchBand.evaluate((element) => element.getBoundingClientRect().top + window.scrollY)
  ]);
  expect(searchBandTop).toBeGreaterThanOrEqual(heroGridBottom - 2);

  const viewport = page.viewportSize();
  if (testInfo.project.name === 'desktop-1440' || testInfo.project.name === 'tablet-1024') {
    const heroBox = await hero.boundingBox();
    const imageBox = await heroImage.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(imageBox).not.toBeNull();
    expect(imageBox!.width).toBeGreaterThan(heroBox!.width * 0.28);
    await expect(page.locator('.v2-gate1-side-photo')).toHaveCount(2);
  } else {
    const heroBox = await hero.boundingBox();
    expect(heroBox).not.toBeNull();
    expect(heroBox!.height).toBeGreaterThan((viewport?.height ?? 720) * 0.78);
    const heroBg = await hero.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(heroBg).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.v2-gate1-side-photo')).toHaveCount(2);
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