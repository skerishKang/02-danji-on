import { expect, test } from '@playwright/test';
import { V2_REFERENCE, V2_SELECTORS } from './v2/reference-contract';
import { firstVisible, openV2 } from './v2/v2-test-helpers';

test.beforeEach(async ({ page }) => {
  await openV2(page);
});

test('V2 preserves the current 20260904 daily-home composition inside the common app shell', async ({ page }) => {
  const topbar = await firstVisible(page, V2_SELECTORS.topbar, 'current editorial topbar');
  const topbarPosition = await topbar.evaluate((element) => getComputedStyle(element).position);
  expect(topbarPosition).toBe('fixed');

  const heading = page.getByRole('heading', { name: V2_REFERENCE.copy.heroHeading });
  await expect(heading).toBeVisible();
  await expect(topbar.getByText('단지온', { exact: true })).toBeVisible();
  const byline = topbar.getByText('DANJION by PADIEM', { exact: true });
  if ((page.viewportSize()?.width ?? 1440) <= 800) await expect(byline).toBeHidden();
  else await expect(byline).toBeVisible();

  await expect(page.getByText('WELCOME HOME · 방림명지로드힐', { exact: true })).toBeVisible();
  await expect(page.getByText('이웃이 실제로 일하는 장면', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder(V2_REFERENCE.copy.heroSearchPlaceholder)).toBeVisible();
  await expect(page.getByRole('button', { name: '검색', exact: true })).toBeVisible();

  await expect(page.getByText('우리 아파트에,', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /가입하고 시작하기/ })).toHaveCount(0);
  await expect(page.locator('.v2-gate1-side-photo')).toHaveCount(0);

  const heroImage = await firstVisible(page, V2_SELECTORS.heroImage, 'current daily-home cinematic image');
  const imageState = await heroImage.evaluate((element) => {
    const image = element as HTMLImageElement;
    return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.currentSrc || image.src };
  });
  expect(imageState.naturalWidth).toBeGreaterThan(300);
  expect(imageState.naturalHeight).toBeGreaterThan(200);
  expect(imageState.src).toBeTruthy();

  await expect(page.getByRole('heading', { name: '가게마다 다른 주민혜택을 이웃가게에서 확인하세요.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '우리단지 새 소식' })).toBeVisible();
});

test('V2 cinematic system preserves four scene buttons, keyboard selection and finite current-home geometry', async ({ page }, testInfo) => {
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
  expect(stagePosition).not.toBe('sticky');

  const worldBox = await cinematic.boundingBox();
  expect(worldBox).not.toBeNull();
  if (testInfo.project.name === 'desktop-1440' || testInfo.project.name === 'tablet-1024') {
    expect(worldBox!.height).toBeGreaterThanOrEqual(590);
    expect(worldBox!.height).toBeLessThanOrEqual(630);
  } else {
    const visual = page.locator('[data-v2-section="cinematic"] .v2-scene-visual');
    const visualBox = await visual.boundingBox();
    expect(visualBox).not.toBeNull();
    expect(visualBox!.height).toBeGreaterThanOrEqual(295);
    expect(visualBox!.height).toBeLessThanOrEqual(305);
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
