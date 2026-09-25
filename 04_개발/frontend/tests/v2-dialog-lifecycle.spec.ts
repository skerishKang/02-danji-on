import { expect, test, type Locator, type Page } from '@playwright/test';

function primaryNav(page: Page): Locator {
  return page.viewportSize()!.width <= 800
    ? page.locator('[data-v2-mobile-nav]')
    : page.locator('[data-v2-topbar] nav[aria-label="주요 메뉴"]');
}

async function openV2(page: Page): Promise<void> {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
  await expect(page.locator('[data-ui-variant="v2"]')).toBeVisible();
}

async function expectDialogManaged(page: Page, dialog: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-v2-dialog-lifecycle', 'managed');
  await expect(dialog.locator('button').first()).toBeFocused();
  await expect.poll(() => dialog.evaluate((element) => [...document.body.querySelectorAll('*')].some((candidate) => {
    const node = candidate as HTMLElement;
    return !element.contains(node) && !node.contains(element) && (node.inert || node.getAttribute('aria-hidden') === 'true');
  }))).toBe(true);
}

test.describe('V2 shared dialog lifecycle', () => {
  test('neighbor shop detail traps Tab, dismisses Escape, and restores its trigger', async ({ page }) => {
    await openV2(page);
    await primaryNav(page).getByRole('button', { name: '이웃가게', exact: true }).click();
    const card = page.locator('.v2-integrated-shop-card').first();
    const trigger = card.getByRole('button', { name: '상세보기', exact: true });
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expectDialogManaged(page, dialog);
    const buttons = dialog.locator('button:visible:not([disabled])');
    await buttons.last().focus();
    await page.keyboard.press('Tab');
    await expect(buttons.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(buttons.last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('[data-v2-dialog-lifecycle="managed"]')).toHaveCount(0);
  });

  test('nested community dialog restores the parent trigger after Escape', async ({ page }) => {
    await openV2(page);
    await primaryNav(page).getByRole('button', { name: '우리단지', exact: true }).click();
    const hub = page.locator('[data-v2-complex-hub]');
    await hub.getByRole('button', { name: '이웃대화 들어가기', exact: true }).click();
    const community = page.locator('.v2-community-layer');
    await expect(community.getByRole('heading', { name: '이웃대화', exact: true })).toBeVisible();

    await community.getByRole('button').filter({ hasText: '궁금해요' }).click();
    const writerTrigger = page.viewportSize()!.width <= 800
      ? community.locator('.v2-community-mobile-write')
      : community.locator('.v2-community-write-main');
    await writerTrigger.click();
    const writer = page.locator('.v2-community-writer');
    await expectDialogManaged(page, writer);

    await page.keyboard.press('Escape');
    await expect(writer).toHaveCount(0);
    await expect(community).toBeVisible();
    await expect(writerTrigger).toBeFocused();
    await expect(page.locator('[data-v2-dialog-lifecycle="managed"]')).toHaveCount(1);
  });

  test('apartment news is an explicit managed dialog with Escape restoration', async ({ page }) => {
    await openV2(page);
    await primaryNav(page).getByRole('button', { name: '우리단지', exact: true }).click();
    const hub = page.locator('[data-v2-complex-hub]');
    const trigger = hub.getByRole('button', { name: '단지온공지 보기', exact: true });
    await trigger.click();

    const dialog = page.locator('[data-v2-complex-news-dialog]');
    await expectDialogManaged(page, dialog);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
