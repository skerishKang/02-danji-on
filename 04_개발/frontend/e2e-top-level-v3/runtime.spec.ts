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

async function installGuard(page: Page, businesses = BUSINESSES): Promise<Guard> {
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
          body: JSON.stringify({ data: businesses })
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

test('#604 Shops preserves adopted V3 presentation while promoting matched live API identity', async ({ page }) => {
  const matched = [{
    id: 'd0a1c4a1-0000-4000-8000-000000000009',
    name: '로드힐 꽃작업실',
    relation_type: 'resident',
    category_slug: 'food'
  }];
  const guard = await installGuard(page, matched);
  const apiKey = 'api-' + matched[0].id;

  await page.goto(withApi('/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html?shop=florist'));

  const card = page.locator('[data-shop-key="' + apiKey + '"]').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.b-card-media img')).toHaveAttribute('src', 'assets/home-florist.png');
  await expect(card.locator('.b-card-desc')).toHaveText('계절 꽃다발과 작은 선물을 예약 상담으로 준비합니다.');
  await expect(card.locator('.b-card-meta')).toContainText('꽃다발 · 작은 선물 · 예약 제작');
  await expect(card.locator('.b-card-meta')).toContainText('꽃다발 예약 상담 시 주민 전용 혜택');

  await expect(page.locator('#shopCompareModal')).toHaveClass(/open/);
  await expect(page.locator('#shopCompareTitle')).toHaveText('로드힐 꽃작업실');
  await expect(page.locator('#shopCompareImage')).toHaveAttribute('src', 'assets/home-florist.png');
  await expect(page.locator('#shopCompareDesc')).toHaveText('계절 꽃다발과 작은 선물을 예약 상담으로 준비합니다.');

  await page.locator('#shopCompareBenefitBtn').click();
  await page.locator('#shopCouponStore').click();
  await expect.poll(async () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('danjion:savedBenefits') || '[]'))
  ).toContain(apiKey);

  await guard.assertClean();
});

test('Complex canonical top-level page renders without runtime errors', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/05_%EC%9A%B0%EB%A6%AC%EB%8B%A8%EC%A7%80_%EC%B2%AB%ED%99%94%EB%A9%B4.html'));
  await expect(page.locator('body[data-danjion-page="5"]')).toBeVisible();
  await expect(page.locator('.channel')).toHaveCount(4);
  await guard.assertClean();
});

test('#600 Apartment News category filters hide non-matching stories and expose empty state', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/08_%EC%95%84%ED%8C%8C%ED%8A%B8%EC%86%8C%EC%8B%9D_%EB%AA%A9%EB%A1%9D.html'));

  const feature = page.locator('.feature');
  const rows = page.locator('.news-row');
  const empty = page.locator('.filter-empty');

  await expect(feature).toBeVisible();
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toBeVisible();
  await expect(empty).toBeHidden();

  await page.getByRole('button', { name: '회장 인사', exact: true }).click();
  await expect(feature).toBeVisible();
  for (const row of await rows.all()) await expect(row).toBeHidden();
  await expect(empty).toBeHidden();

  await page.getByRole('button', { name: '회의 후 진행', exact: true }).click();
  await expect(feature).toBeHidden();
  await expect(page.locator('.news-row[data-kind="progress"]')).toBeVisible();
  await expect(page.locator('.news-row[data-kind="life"]')).toBeHidden();
  await expect(page.locator('.news-row[data-kind="record"]')).toBeHidden();
  await expect(empty).toBeHidden();

  await page.getByRole('button', { name: '생활소식', exact: true }).click();
  await expect(feature).toBeHidden();
  await expect(page.locator('.news-row[data-kind="progress"]')).toBeHidden();
  await expect(page.locator('.news-row[data-kind="life"]')).toBeVisible();
  await expect(page.locator('.news-row[data-kind="record"]')).toBeHidden();
  await expect(empty).toBeHidden();

  await page.getByRole('button', { name: '현장기록', exact: true }).click();
  await expect(feature).toBeHidden();
  await expect(page.locator('.news-row[data-kind="progress"]')).toBeHidden();
  await expect(page.locator('.news-row[data-kind="life"]')).toBeHidden();
  await expect(page.locator('.news-row[data-kind="record"]')).toBeVisible();
  await expect(empty).toBeHidden();

  await page.getByRole('button', { name: '단지 변화', exact: true }).click();
  await expect(feature).toBeHidden();
  for (const row of await rows.all()) await expect(row).toBeHidden();
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText('해당 분류의 소식이 아직 없습니다.');

  await page.getByRole('button', { name: '전체', exact: true }).click();
  await expect(feature).toBeVisible();
  for (const row of await rows.all()) await expect(row).toBeVisible();
  await expect(empty).toBeHidden();

  await guard.assertClean();
});

test('My Info canonical top-level page renders signed-out without runtime errors', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html'));
  await expect(page.locator('body[data-danjion-page="19"]')).toBeVisible();
  await expect(page.locator('[data-account-host]').first()).toBeVisible();
  await guard.assertClean();
});


test('#583 desktop non-header interactions expose pointer and keyboard feedback', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const guard = await installGuard(page);

  await page.goto(withApi('/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html'));
  const brand = page.locator('.danjion-service-header .brand').first();
  await expect(brand).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(brand).toBeFocused();
  const outlineWidth = await brand.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth));
  expect(outlineWidth).toBeGreaterThanOrEqual(3);

  const inactiveScene = page.locator('.scene-tab:not(.active)').first();
  const beforeHoverBorder = await inactiveScene.evaluate(el => getComputedStyle(el).borderTopColor);
  await inactiveScene.hover();
  await page.waitForTimeout(250);
  const hoverBorder = await inactiveScene.evaluate(el => getComputedStyle(el).borderTopColor);
  expect(hoverBorder).not.toBe(beforeHoverBorder);

  await page.goto(withApi('/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html'));
  const card = page.locator('.b-shop-card[tabindex="0"]').first();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shopCompareModal')).toHaveClass(/open/);

  await page.goto(withApi('/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html'));
  const levelCard = page.locator('.level-card[role="link"][tabindex="0"]');
  await expect(levelCard).toBeVisible();
  await levelCard.focus();
  await page.keyboard.press(' ');
  await page.waitForURL(/23_%EC%9D%B4%EC%9B%83%EC%98%A8%EA%B8%B0\.html/);

  await guard.assertClean();
});

test('#583 mobile controls meet touch-target policy and Warmth toast clears bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const guard = await installGuard(page);

  const expectMinHit = async (selector: string, minWidth = 44, minHeight = 44) => {
    const locator = page.locator(selector).first();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, selector + ' must have a measurable hit box').not.toBeNull();
    expect(box!.width, selector + ' width').toBeGreaterThanOrEqual(minWidth);
    expect(box!.height, selector + ' height').toBeGreaterThanOrEqual(minHeight);
  };

  await page.goto(withApi('/04_%EB%8D%B0%EC%9D%BC%EB%A6%AC%ED%99%88.html'));
  await expectMinHit('.danjion-service-header .brand');
  await expectMinHit('#saveBtn');
  await expectMinHit('.news-head button');

  await page.goto(withApi('/01_%EC%9D%B4%EC%9B%83%EA%B0%80%EA%B2%8C_%EB%B0%9C%EA%B2%AC.html'));
  await expectMinHit('.filter');
  await expectMinHit('.b-save');

  await page.goto(withApi('/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html'));
  await expectMinHit('.level-chip');

  await page.goto('/23_%EC%9D%B4%EC%9B%83%EC%98%A8%EA%B8%B0.html');
  await expectMinHit('.back');
  await page.locator('.toast').evaluate((el: HTMLElement) => {
    el.textContent = '모바일 토스트 여백 확인';
    el.classList.add('show');
  });
  await page.waitForTimeout(300);
  const toastBox = await page.locator('.toast').boundingBox();
  const navBox = await page.locator('.mobile-bottom').boundingBox();
  expect(toastBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  const gap = navBox!.y - (toastBox!.y + toastBox!.height);
  expect(gap).toBeGreaterThanOrEqual(16);

  await guard.assertClean();
});


test('#592 pre-registered admin bootstrap re-reads canonical authority before opening console', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const bootstrapBodies: Array<string | null> = [];
  let authorityReads = 0;

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
        unexpectedMutations.push(method + ' ' + request.url());
      }
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    if (url.pathname === '/api/v1/admin/authority' && method === 'GET') {
      authorityReads += 1;
      if (authorityReads === 1) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ADMIN_AUTHORITY_REQUIRED' } })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            level: 'operator',
            label: '일반관리자',
            wildcard: false,
            scopes: ['business.review']
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/bootstrap' && method === 'POST') {
      bootstrapBodies.push(request.postData());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            level: 'operator',
            label: '일반관리자',
            wildcard: false,
            scopes: ['business.review']
          }
        })
      });
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      unexpectedMutations.push(method + ' ' + url.pathname);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST_MUTATION_BLOCKED' } })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    });
  });

  await page.goto(withApi('/admin/'));
  const activate = page.getByRole('button', { name: '등록된 관리자 권한 확인' });
  await expect(activate).toBeVisible();
  await expect(page.locator('#adminMain')).toBeHidden();

  await activate.click();

  await expect(page.locator('#roleBadge')).toHaveText('운영관리자');
  await expect(page.locator('#adminMain')).toBeVisible();
  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();

  expect(authorityReads).toBe(2);
  expect(bootstrapBodies).toEqual([null]);
  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);

  const expectedDeniedNoise = consoleErrors.filter(message =>
    message.includes('Failed to load resource') && message.includes('403')
  );
  const unexpectedConsoleErrors = consoleErrors.filter(message =>
    !(message.includes('Failed to load resource') && message.includes('403'))
  );
  expect(expectedDeniedNoise.length).toBeGreaterThanOrEqual(1);
  expect(unexpectedConsoleErrors).toEqual([]);
});


test('#607 bounded admin business review performs one server-authorized PATCH and refreshes the row', async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const applicationId = 'd0a1c4a1-0000-4000-8000-000000000021';
  const patchBodies: any[] = [];
  let applicationStatus = 'pending';

  page.on('pageerror', error => pageErrors.push(error.stack || error.message));

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const local = url.origin === BASE;

    if (!local) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) unexpectedMutations.push(method + ' ' + request.url());
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    if (url.pathname === '/api/v1/admin/authority' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            level: 'operator',
            label: '일반관리자',
            wildcard: false,
            scopes: ['business.review']
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/complexes/' + COMPLEX + '/business-applications' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: applicationId,
            business_name: '런타임 꽃집',
            category_name: '꽃·선물',
            relation_type: 'resident',
            service_summary: '예약 꽃다발 제작',
            service_area: '방림동',
            price_text: '상담',
            contact_method: '1:1 문의',
            benefit_text: '주민 예약 혜택',
            availability_text: '예약 운영',
            status: applicationStatus,
            applicant_name: '테스트 주민',
            created_at: '2026-09-16T12:00:00Z'
          }]
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/business-applications/' + applicationId && method === 'PATCH') {
      patchBodies.push(JSON.parse(request.postData() || '{}'));
      applicationStatus = String(patchBodies.at(-1)?.status || applicationStatus);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { id: applicationId, status: applicationStatus } })
      });
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      unexpectedMutations.push(method + ' ' + url.pathname);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST_MUTATION_BLOCKED' } })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    });
  });

  page.on('dialog', dialog => dialog.accept());
  await page.goto(withApi('/admin/'));

  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '런타임 꽃집' })).toBeVisible();
  await expect(page.locator('.admin-fact').filter({ hasText: '꽃·선물' })).toBeVisible();
  await expect(page.getByRole('button', { name: '승인', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '수정요청', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '거절', exact: true })).toBeVisible();

  await page.getByRole('textbox', { name: '검토 메모' }).fill('현장 확인 완료');
  await page.getByRole('button', { name: '승인', exact: true }).click();

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies).toEqual([{ status: 'approved', reviewNote: '현장 확인 완료' }]);
  await expect(page.getByText('처리 완료된 신청입니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '승인', exact: true })).toHaveCount(0);
  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});


test('#609 admin official-news creates a draft then publishes it through the existing server authority', async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const postId = 'd0a1c4a1-0000-4000-8000-000000000031';
  const postBodies: any[] = [];
  const patchBodies: any[] = [];
  let rows: any[] = [];

  page.on('pageerror', error => pageErrors.push(error.stack || error.message));

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const local = url.origin === BASE;

    if (!local) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) unexpectedMutations.push(method + ' ' + request.url());
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }

    if (url.pathname === '/api/v1/admin/authority' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            level: 'operator',
            label: '일반관리자',
            wildcard: false,
            scopes: ['official-content.manage']
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/complexes/' + COMPLEX + '/posts' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/complexes/' + COMPLEX + '/posts' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      postBodies.push(body);
      rows = [{
        id: postId,
        source_name: body.sourceName,
        category: body.category,
        channel: 'danjion_notice',
        title: body.title,
        body: body.body,
        status: body.status,
        created_at: '2026-09-16T13:45:00Z',
        updated_at: '2026-09-16T13:45:00Z'
      }];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows[0] })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/posts/' + postId && method === 'PATCH') {
      const body = JSON.parse(request.postData() || '{}');
      patchBodies.push(body);
      rows = [{ ...rows[0], source_name: body.sourceName, category: body.category, title: body.title, body: body.body, status: body.status }];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows[0] })
      });
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      unexpectedMutations.push(method + ' ' + url.pathname);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST_MUTATION_BLOCKED' } })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] })
    });
  });

  page.on('dialog', dialog => dialog.accept());
  await page.goto(withApi('/admin/'));

  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '단지소식', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '새 단지소식 작성' })).toBeVisible();

  const composer = page.locator('.admin-post-editor.create');
  await composer.getByLabel('분류').fill('생활소식');
  await composer.getByLabel('소식 제목').fill('엘리베이터 점검 안내');
  await composer.getByLabel('소식 본문').fill('오후 2시부터 엘리베이터 정기점검을 진행합니다.');
  await composer.getByLabel('게시 상태').selectOption('draft');
  await composer.getByRole('button', { name: '새 소식 저장' }).click();

  await expect.poll(() => postBodies.length).toBe(1);
  expect(postBodies[0]).toEqual({
    sourceName: '단지온 운영자',
    category: '생활소식',
    title: '엘리베이터 점검 안내',
    body: '오후 2시부터 엘리베이터 정기점검을 진행합니다.',
    status: 'draft'
  });

  const card = page.locator('.admin-card').filter({ hasText: '엘리베이터 점검 안내' });
  await expect(card).toBeVisible();
  await expect(card.locator('.admin-status')).toHaveText('draft');

  await card.getByLabel('게시 상태').selectOption('published');
  await card.getByRole('button', { name: '변경 저장' }).click();

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0].status).toBe('published');
  await expect(page.locator('.admin-card').filter({ hasText: '엘리베이터 점검 안내' }).locator('.admin-status')).toHaveText('published');

  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});
