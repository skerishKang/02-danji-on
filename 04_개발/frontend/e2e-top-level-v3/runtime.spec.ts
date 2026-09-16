import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:4174';
const COMPLEX = 'banglim-myeongji-roadhill';
const BUSINESSES = [
  {
    id: 'd0a1c4a1-0000-4000-8000-000000000001',
    name: '런타임 반찬가게',
    summary: '브라우저 게이트용 공개 이웃가게 1',
    relation_type: 'resident',
    category_slug: 'food',
    price_text: '예약 주문',
    active_benefit: { title: '주민 10% 혜택' }
  },
  {
    id: 'd0a1c4a1-0000-4000-8000-000000000002',
    name: '런타임 공부방',
    summary: '브라우저 게이트용 공개 이웃가게 2',
    relation_type: 'resident_family',
    category_slug: 'learn',
    availability_text: '평일 운영'
  },
  {
    id: 'd0a1c4a1-0000-4000-8000-000000000005',
    name: '런타임 홈케어',
    summary: '브라우저 게이트용 공개 이웃가게 3',
    relation_type: 'neighbor',
    category_slug: 'home',
    price_text: '1:1 문의'
  },
  {
    id: 'd0a1c4a1-0000-4000-8000-000000000008',
    name: '런타임 전문가',
    summary: '브라우저 게이트용 공개 이웃가게 4',
    relation_type: 'resident',
    category_slug: 'pro',
    price_text: '상담 문의'
  }
];

type Guard = {
  pageErrors: string[];
  consoleErrors: string[];
  mutationRequests: string[];
  assertClean(): Promise<void>;
};

async function installGuard(page: Page): Promise<Guard> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const mutationRequests: string[] = [];

  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const local = url.origin === BASE;

    if (!local) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        mutationRequests.push(method + ' ' + request.url());
      }
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        mutationRequests.push(method + ' ' + url.pathname);
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'TEST_MUTATION_BLOCKED' } })
        });
        return;
      }

      if (url.pathname === '/api/v1/complexes/' + COMPLEX + '/businesses') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: BUSINESSES })
        });
        return;
      }

      if (url.pathname === '/api/v1/me') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { user: null } })
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] })
      });
      return;
    }

    await route.continue();
  });

  return {
    pageErrors,
    consoleErrors,
    mutationRequests,
    async assertClean() {
      expect(pageErrors, 'pageerror must stay empty').toEqual([]);
      expect(consoleErrors, 'unexpected console.error must stay empty').toEqual([]);
      expect(mutationRequests, 'browser gate must not issue network mutations').toEqual([]);
    }
  };
}

function withApi(path: string): string {
  const join = path.includes('?') ? '&' : '?';
  return path + join + 'apiBase=' + encodeURIComponent(BASE);
}

test('Intro renders signed-out shell without runtime errors', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto('/index.html?intro=1');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.getByText('로그인', { exact: true }).first()).toBeVisible();
  const admin = page.locator('.admin-entry').first();
  if (await admin.count()) await expect(admin).toBeHidden();
  await guard.assertClean();
});

test('Home executes businesses SUCCESS authority path, setScene, canonical detail route, and autoplay', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html'));

  const firstKey = 'api-' + BUSINESSES[0].id;
  const detail = page.locator('#detailBtn');
  await expect(page.locator('.scene-tab').first()).toHaveAttribute('data-key', firstKey);
  await expect(detail).toHaveAttribute('data-shop-key', firstKey);
  await expect(detail).toHaveAttribute(
    'data-route',
    '01_이웃가게_발견.html?shop=' + firstKey + '&from=home'
  );
  await expect(page.locator('#shopName')).toHaveText(BUSINESSES[0].name);

  const initial = await detail.getAttribute('data-shop-key');
  await page.waitForFunction(
    key => document.querySelector('#detailBtn')?.getAttribute('data-shop-key') !== key,
    initial,
    { timeout: 8_000 }
  );

  await guard.assertClean();
});

test('Shops resolves an API shop deep-link only after authority replacement and opens the canonical in-page popup', async ({ page }) => {
  const guard = await installGuard(page);
  const key = 'api-' + BUSINESSES[1].id;
  await page.goto(withApi('/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html?shop=' + encodeURIComponent(key) + '&from=home'));

  const card = page.locator('[data-shop-key="' + key + '"]').first();
  await expect(card).toBeVisible();
  await expect(page.locator('#shopCompareModal')).toHaveClass(/open/);
  await expect(page.locator('#shopCompareTitle')).toHaveText(BUSINESSES[1].name);
  expect(page.url()).toContain('shop=' + encodeURIComponent(key));
  expect(page.url()).toContain('from=home');
  expect(page.url()).not.toContain('02_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EC%83%81%EC%84%B8');

  await guard.assertClean();
});

test('Complex canonical top-level page renders without runtime errors', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/05_%EC%9A%B0%EB%A6%AC%EB%8B%A8%EC%A7%80_%EC%B2%AB%ED%99%94%EB%A9%B4.html'));
  await expect(page.locator('body[data-danjion-page="5"]')).toBeVisible();
  await expect(page.locator('.channel')).toHaveCount(4);
  await guard.assertClean();
});

test('My Info canonical top-level page renders signed-out without runtime errors', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html'));
  await expect(page.locator('body[data-danjion-page="19"]')).toBeVisible();
  await expect(page.locator('[data-account-host]').first()).toBeVisible();
  await guard.assertClean();
});
