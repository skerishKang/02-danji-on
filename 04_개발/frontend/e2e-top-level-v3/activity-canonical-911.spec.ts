import { test, expect, type Page } from '@playwright/test';

// Issue #911: canonical Production resolves DanjionSession.danjionApiBase() to ''
// (same-origin Pages facade), so page 28 must still choose the server-owned lane
// for view=saved / view=benefits via DanjionSession.isCanonicalProduction().
//
// The browser-level proof needs a canonical hostname, so this file launches its
// own Chromium with a host-resolver MAP (danjion.padiem.net -> 127.0.0.1). The
// shared playwright-top-level-v3.config.ts stays untouched; every other spec keeps
// the plain 127.0.0.1 origin.

const CANONICAL_HOST = 'danjion.padiem.net';
// CI / shared config serve on 4174. A local run may override the port when the
// fixed port is unavailable (e.g. Windows excluded port ranges); the spec follows.
const PORT = process.env.DANJION_E2E_PORT || '4174';
const PAGE_FILE = '28_나의활동.html';
const UUID = 'a0a1c4a1-1111-4111-8111-111111111111';
const CLAIM_UUID = 'b1b2c3d4-2222-4222-8222-222222222222';

test.use({
  launchOptions: {
    args: [`--host-resolver-rules=MAP ${CANONICAL_HOST} 127.0.0.1`]
  }
});

async function seedLocalDemo(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('danjion:savedShops', JSON.stringify(['food']));
    localStorage.setItem('danjion:savedBenefits', JSON.stringify(['food']));
    sessionStorage.setItem('danjion:shopVariant', 'v3');
    localStorage.setItem('danjion:shopVariant', 'v3');
  });
}

async function mockApplicationApi(page: Page) {
  const json = (body: unknown) => ({
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
  // Registered first (lowest priority): nothing under /api ever reaches python http.server.
  await page.route('**/api/**', route =>
    route.fulfill({ status: 404, ...json({ error: { code: 'NOT_FOUND' } }) })
  );
  await page.route('**/api/auth/get-session', route => route.fulfill({ status: 200, body: 'null' }));
  await page.route('**/api/v1/me/bookmarks', route => route.fulfill({ status: 200, ...json({ data: [{ id: UUID }] }) }));
  await page.route('**/api/v1/complexes/banglim-myeongji-roadhill/businesses*', route =>
    route.fulfill({
      status: 200,
      ...json({
        data: [{
          id: UUID,
          name: '서버 정원꽃집',
          summary: '서버 응답 저장 가게입니다.',
          price_text: '예약 상담'
        }]
      })
    })
  );
  await page.route('**/api/v1/me/benefits', route =>
    route.fulfill({
      status: 200,
      ...json({
        data: [{
          id: CLAIM_UUID,
          benefit_id: UUID,
          claim_code: 'CLAIM-911',
          status: 'issued',
          claimed_at: '2026-09-20T00:00:00.000Z',
          title: '서버 발급 주민 혜택',
          business_name: '정원 꽃집',
          description: '서버에 실제로 발급된 혜택입니다.',
          complex_slug: 'banglim-myeongji-roadhill'
        }]
      })
    })
  );
}

function collectPageErrors(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  return pageErrors;
}

test('#911 canonical empty-base Production: view=saved is server-owned', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const bookmarkRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/me/bookmarks')) bookmarkRequests.push(request.url());
  });
  await seedLocalDemo(page);
  await mockApplicationApi(page);

  await page.goto(`http://${CANONICAL_HOST}:${PORT}/${encodeURI(PAGE_FILE)}?view=saved`, { waitUntil: 'load' });

  expect(await page.evaluate(() => (window as any).DanjionSession.danjionApiBase())).toBe('');
  expect(await page.evaluate(() => (window as any).DanjionSession.isCanonicalProduction())).toBe(true);
  expect(await page.evaluate(() => (window as any).__danjionActivitySpecialServerOwned)).toBe(true);

  await expect(page.locator('.rows [data-server-business]')).toHaveCount(1);
  await expect(page.locator('.rows')).toContainText('서버 정원꽃집');
  await expect(page.locator('.list-count')).toContainText('저장 1개');

  expect(bookmarkRequests.length, 'saved-shops bridge must actually be called').toBeGreaterThan(0);

  // Local/demo state must never present itself as authoritative Production data.
  await expect(page.locator('body')).not.toHaveClass(/visual-special/);
  await expect(page.locator('.rows .visual-shop-card')).toHaveCount(0);
  await expect(page.locator('.rows')).not.toContainText('오늘의 반찬');
  await expect(page.locator('.rows')).not.toContainText('시연용');

  expect(pageErrors, 'canonical saved view must load without runtime errors').toEqual([]);
});

test('#911 canonical empty-base Production: view=benefits is server-owned', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const benefitRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/me/benefits')) benefitRequests.push(request.url());
  });
  await seedLocalDemo(page);
  await mockApplicationApi(page);

  await page.goto(`http://${CANONICAL_HOST}:${PORT}/${encodeURI(PAGE_FILE)}?view=benefits`, { waitUntil: 'load' });

  expect(await page.evaluate(() => (window as any).DanjionSession.danjionApiBase())).toBe('');
  expect(await page.evaluate(() => (window as any).DanjionSession.isCanonicalProduction())).toBe(true);
  expect(await page.evaluate(() => (window as any).__danjionActivitySpecialServerOwned)).toBe(true);

  await expect(page.locator('.rows')).toContainText('서버 발급 주민 혜택');
  await expect(page.locator('.rows')).toContainText('CLAIM-911');
  await expect(page.locator('.list-count')).toContainText('전체 1개');

  expect(benefitRequests.length, 'benefit wallet bridge must actually be called').toBeGreaterThan(0);

  await expect(page.locator('body')).not.toHaveClass(/visual-special/);
  await expect(page.locator('.rows .visual-benefit-card')).toHaveCount(0);
  await expect(page.locator('.rows')).not.toContainText('시연용');

  expect(pageErrors, 'canonical benefits view must load without runtime errors').toEqual([]);
});

test('#911 non-canonical unbound preview keeps bounded demo behavior', async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  const serverRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/v1/me/bookmarks') || request.url().includes('/api/v1/me/benefits')) {
      serverRequests.push(request.url());
    }
  });
  await seedLocalDemo(page);
  await mockApplicationApi(page);

  await page.goto(`/${encodeURI(PAGE_FILE)}?view=saved`, { waitUntil: 'load' });

  expect(await page.evaluate(() => (window as any).DanjionSession.danjionApiBase())).toBe('');
  expect(await page.evaluate(() => (window as any).DanjionSession.isCanonicalProduction())).toBe(false);
  expect(await page.evaluate(() => (window as any).__danjionActivitySpecialServerOwned)).toBeFalsy();

  await expect(page.locator('body')).toHaveClass(/visual-special/);
  await expect(page.locator('.rows .visual-shop-card').first()).toBeVisible();
  await expect(page.locator('.rows')).toContainText('오늘의 반찬');

  expect(serverRequests, 'unbound preview must not emit saved/benefit server traffic').toEqual([]);
  expect(pageErrors, 'preview demo lane must load without runtime errors').toEqual([]);
});
