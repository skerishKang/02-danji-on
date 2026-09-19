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

async function installGuard(page: Page, businesses = BUSINESSES, authenticated = false): Promise<Guard> {
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

      if (url.pathname === '/api/auth/get-session') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: authenticated
            ? JSON.stringify({
                session: { id: 'runtime-session', userId: 'runtime-member', expiresAt: '2099-01-01T00:00:00.000Z' },
                user: {
                  id: 'runtime-member',
                  name: '런타임 주민',
                  email: 'runtime-member@example.invalid',
                  emailVerified: true,
                  createdAt: '2026-01-01T00:00:00.000Z'
                }
              })
            : 'null'
        });
        return;
      }

      if (url.pathname === '/api/auth/list-accounts') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(authenticated ? [{ providerId: 'credential' }] : [])
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
  await expect(page.locator('#shopCouponStore')).toBeDisabled();
  await expect(page.locator('#shopCouponStore')).toHaveText('혜택 받기');
  await expect.poll(async () =>
    page.evaluate(() => localStorage.getItem('danjion:savedBenefits'))
  ).toBeNull();

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

test('My Info canonical top-level page gates signed-out guests without exposing the private dashboard', async ({ page }) => {
  const guard = await installGuard(page);
  await page.goto(withApi('/19_%EB%82%B4%EC%A0%95%EB%B3%B4_%EB%A9%94%EC%9D%B8.html'));
  await expect(page.locator('body[data-danjion-page="19"]')).toBeVisible();
  await expect(page.locator('[data-account-host]').first()).toBeVisible();
  await expect(page.locator('#myinfoAccessGate')).toBeVisible();
  await expect(page.locator('#myinfoGuestLogin')).toBeVisible();
  await expect(page.locator('#myinfoGuestLogin')).toHaveAttribute('href', 'index.html?auth=login');
  await expect(page.locator('#myinfoPrivateContent')).toBeHidden();
  await expect(page.locator('.level-card[role="link"][tabindex="0"]')).toBeHidden();
  await guard.assertClean();
});


test('#583 desktop non-header interactions expose pointer and keyboard feedback', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const guard = await installGuard(page, BUSINESSES, true);

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
  const guard = await installGuard(page, BUSINESSES, true);

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


test('#611 admin resident-benefit selects an approved business, creates a draft, then activates it', async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const businessId = 'd0a1c4a1-0000-4000-8000-000000000041';
  const benefitId = 'd0a1c4a1-0000-4000-8000-000000000042';
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
            scopes: ['benefit.manage']
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/complexes/' + COMPLEX + '/businesses' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: businessId,
            name: '온케어 홈서비스',
            status: 'approved',
            relation_type: 'resident'
          }]
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/complexes/' + COMPLEX + '/benefits' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/complexes/' + COMPLEX + '/benefits' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      postBodies.push(body);
      rows = [{
        id: benefitId,
        business_id: businessId,
        business_name: '온케어 홈서비스',
        title: body.title,
        description: body.description,
        conditions: body.conditions,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        status: body.status,
        created_at: '2026-09-16T14:20:00Z',
        updated_at: '2026-09-16T14:20:00Z'
      }];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows[0] })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/benefits/' + benefitId && method === 'PATCH') {
      const body = JSON.parse(request.postData() || '{}');
      patchBodies.push(body);
      rows = [{
        ...rows[0],
        title: body.title,
        description: body.description,
        conditions: body.conditions,
        starts_at: body.startsAt,
        ends_at: body.endsAt,
        status: body.status
      }];
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
  await expect(page.getByRole('heading', { name: '주민혜택', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '새 주민혜택 등록' })).toBeVisible();

  const composer = page.locator('.admin-post-editor.create');
  await composer.getByLabel('대상 가게').selectOption(businessId);
  await composer.getByLabel('혜택 제목').fill('주민 전용 방문 혜택');
  await composer.getByLabel('혜택 설명').fill('방림명지로드힐 주민 대상 방문 서비스 혜택입니다.');
  await composer.getByLabel('이용 조건').fill('예약 시 단지온 주민 화면 확인');
  await composer.getByLabel('혜택 상태').selectOption('draft');
  await composer.getByRole('button', { name: '새 혜택 저장' }).click();

  await expect.poll(() => postBodies.length).toBe(1);
  expect(postBodies[0]).toEqual({
    businessId,
    title: '주민 전용 방문 혜택',
    description: '방림명지로드힐 주민 대상 방문 서비스 혜택입니다.',
    conditions: '예약 시 단지온 주민 화면 확인',
    startsAt: null,
    endsAt: null,
    status: 'draft'
  });

  const card = page.locator('.admin-card').filter({ hasText: '주민 전용 방문 혜택' });
  await expect(card).toBeVisible();
  await expect(card.locator('.admin-status')).toHaveText('draft');
  await expect(card.getByText('대상 가게: 온케어 홈서비스', { exact: true })).toBeVisible();

  await card.getByLabel('혜택 상태').selectOption('active');
  await card.getByRole('button', { name: '혜택 변경 저장' }).click();

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0].status).toBe('active');
  expect(patchBodies[0].businessId).toBeUndefined();
  await expect(page.locator('.admin-card').filter({ hasText: '주민 전용 방문 혜택' }).locator('.admin-status')).toHaveText('active');

  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});


test('#613 superadmin manages the four designated administrator principals without exposing the surface to operators', async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const postBodies: any[] = [];
  const patchBodies: any[] = [];
  let authorityMode: 'admin' | 'operator' = 'operator';
  let nextPrincipalSuffix = 64;
  let rows: any[] = [
    {
      id: 'd0a1c4a1-0000-4000-8000-000000000061',
      email: 'owner-super@example.com',
      role: 'admin',
      status: 'active',
      scopes: ['*'],
      runtimeUserCount: 1,
      runtimeScopes: ['*'],
      runtimeRole: 'admin'
    },
    {
      id: 'd0a1c4a1-0000-4000-8000-000000000062',
      email: 'sibling-super@example.com',
      role: 'admin',
      status: 'active',
      scopes: ['*'],
      runtimeUserCount: 1,
      runtimeScopes: ['*'],
      runtimeRole: 'admin'
    },
    {
      id: 'd0a1c4a1-0000-4000-8000-000000000063',
      email: 'owner-ops@example.com',
      role: 'operator',
      status: 'active',
      scopes: ['benefit.manage','business.review','official-content.manage','resident_news.review'],
      runtimeUserCount: 1,
      runtimeScopes: ['benefit.manage','business.review','official-content.manage','resident_news.review'],
      runtimeRole: 'operator'
    },
    {
      id: 'd0a1c4a1-0000-4000-8000-000000000060',
      email: 'owner-super@example.com',
      role: 'operator',
      status: 'revoked',
      scopes: ['benefit.manage','business.review','official-content.manage','resident_news.review'],
      runtimeUserCount: 0,
      runtimeScopes: [],
      runtimeRole: 'none'
    }
  ];

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
      const admin = authorityMode === 'admin';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: admin
            ? { level: 'admin', label: '최고관리자', wildcard: true, scopes: ['*'] }
            : {
                level: 'operator',
                label: '일반관리자',
                wildcard: false,
                scopes: ['benefit.manage','business.review','official-content.manage','resident_news.review']
              }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/principals' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/principals' && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      postBodies.push(body);
      const email = String(body.email || '').trim().toLowerCase();
      if (rows.some((row) => row.status === 'active' && String(row.email).toLowerCase() === email)) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ADMIN_PRINCIPAL_EXISTS' } })
        });
        return;
      }
      const row = {
        id: 'd0a1c4a1-0000-4000-8000-' + String(nextPrincipalSuffix++).padStart(12, '0'),
        email,
        role: body.role,
        status: 'active',
        scopes: body.role === 'admin' ? ['*'] : ['benefit.manage','business.review','official-content.manage','resident_news.review'],
        runtimeUserCount: 0,
        runtimeScopes: [],
        runtimeRole: 'none'
      };
      rows = [...rows, row];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: row })
      });
      return;
    }

    const principalMatch = url.pathname.match(/^\/api\/v1\/admin\/principals\/([0-9a-f-]+)$/i);
    if (principalMatch && method === 'PATCH') {
      const body = JSON.parse(request.postData() || '{}');
      patchBodies.push({ id: principalMatch[1], ...body });
      const current = rows.find((row) => row.id === principalMatch[1]);
      if (
        principalMatch[1] === 'd0a1c4a1-0000-4000-8000-000000000061'
        && (body.role !== 'admin' || body.status !== 'active')
      ) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'SELF_LOCKOUT_BLOCKED' } })
        });
        return;
      }
      if (
        current
        && body.status === 'active'
        && rows.some((row) =>
          row.id !== current.id
          && row.status === 'active'
          && String(row.email).toLowerCase() === String(current.email).toLowerCase()
        )
      ) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'ADMIN_PRINCIPAL_EXISTS' } })
        });
        return;
      }
      rows = rows.map((row) => row.id === principalMatch[1]
        ? {
            ...row,
            role: body.role,
            status: body.status,
            scopes: body.role === 'admin' ? ['*'] : ['benefit.manage','business.review','official-content.manage','resident_news.review'],
            runtimeScopes: body.status === 'active' ? (body.role === 'admin' ? ['*'] : ['benefit.manage','business.review','official-content.manage','resident_news.review']) : [],
            runtimeRole: body.status === 'active' ? body.role : 'none'
          }
        : row);
      const updated = rows.find((row) => row.id === principalMatch[1]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: updated })
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
  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();
  await expect(page.getByRole('button', { name: '최고관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '사용자 · 권한 관리', exact: true })).toHaveCount(0);

  authorityMode = 'admin';
  await page.reload();
  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();
  await page.getByRole('button', { name: '최고관리', exact: true }).click();
  await expect(page.getByRole('button', { name: '사용자 · 권한 관리', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '사용자 · 권한 관리', exact: true }).click();

  await expect(page.getByRole('heading', { name: '사용자 · 권한 관리', exact: true })).toBeVisible();
  await expect(page.getByText('활성 최고관리자 2 / 목표 2', { exact: true })).toBeVisible();
  await expect(page.getByText('활성 일반관리자 1 / 목표 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Runtime: 최고관리자 · 연결 사용자 1명', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.principal-form input')).toHaveCount(2);
  await expect(page.locator('.principal-form select')).toHaveCount(1);

  await page.getByLabel('관리자 이메일').fill('sibling-ops@example.com');
  await page.locator('.principal-form').getByLabel('관리자 등급').selectOption('operator');
  await page.getByLabel('관리자 등록 사유').fill('four-principal setup');
  await page.getByRole('button', { name: '관리자 추가', exact: true }).click();

  await expect.poll(() => postBodies.length).toBe(1);
  expect(postBodies[0]).toEqual({
    email: 'sibling-ops@example.com',
    role: 'operator',
    reason: 'four-principal setup'
  });
  await expect(page.getByText('활성 일반관리자 2 / 목표 2', { exact: true })).toBeVisible();

  const newCard = page.locator('.principal-card').filter({ hasText: 'sibling-ops@example.com' });
  await expect(newCard).toBeVisible();
  await newCard.getByLabel('관리자 등급').selectOption('admin');
  await newCard.getByLabel('권한 변경 사유').fill('temporary promotion check');
  await newCard.getByRole('button', { name: '권한 변경 저장', exact: true }).click();

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0]).toMatchObject({
    id: 'd0a1c4a1-0000-4000-8000-000000000064',
    role: 'admin',
    status: 'active',
    reason: 'temporary promotion check'
  });
  await expect(page.getByText('활성 최고관리자 3 / 목표 2', { exact: true })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await newCard.getByLabel('관리자 등급').selectOption('operator');
  await newCard.getByLabel('권한 변경 사유').fill('return to operational');
  await newCard.getByRole('button', { name: '권한 변경 저장', exact: true }).click();
  await expect.poll(() => patchBodies.length).toBe(2);
  await expect(page.getByText('활성 최고관리자 2 / 목표 2', { exact: true })).toBeVisible();
  await expect(page.getByText('활성 일반관리자 2 / 목표 2', { exact: true })).toBeVisible();

  const historicalDuplicate = page.locator('.principal-card')
    .filter({ hasText: 'owner-super@example.com' })
    .filter({ hasText: '설정: 일반관리자 · 해제' });
  await historicalDuplicate.getByLabel('관리자 상태').selectOption('active');
  await historicalDuplicate.getByRole('button', { name: '권한 변경 저장', exact: true }).click();
  await expect.poll(() => patchBodies.length).toBe(3);
  await expect(historicalDuplicate.locator('.admin-post-status')).toHaveText('이미 활성 등록된 관리자 이메일입니다.');

  await page.getByLabel('관리자 이메일').fill('temporary-super@example.com');
  await page.locator('.principal-form').getByLabel('관리자 등급').selectOption('admin');
  await page.getByLabel('관리자 등록 사유').fill('new SUPER registration contract');
  await page.getByRole('button', { name: '관리자 추가', exact: true }).click();
  await expect.poll(() => postBodies.length).toBe(2);
  expect(postBodies[1]).toMatchObject({
    email: 'temporary-super@example.com',
    role: 'admin',
    reason: 'new SUPER registration contract'
  });
  const tempSuper = page.locator('.principal-card').filter({ hasText: 'temporary-super@example.com' });
  await expect(tempSuper).toBeVisible();
  await expect(page.getByText('활성 최고관리자 3 / 목표 2', { exact: true })).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await tempSuper.getByLabel('관리자 상태').selectOption('revoked');
  await tempSuper.getByLabel('권한 변경 사유').fill('revoke contract');
  await tempSuper.getByRole('button', { name: '권한 변경 저장', exact: true }).click();
  await expect.poll(() => patchBodies.length).toBe(4);
  await expect(page.getByText('활성 최고관리자 2 / 목표 2', { exact: true })).toBeVisible();

  const ownerSuper = page.locator('.principal-card')
    .filter({ hasText: 'owner-super@example.com' })
    .filter({ hasText: '설정: 최고관리자 · 활성' });
  page.once('dialog', dialog => dialog.accept());
  await ownerSuper.getByLabel('관리자 등급').selectOption('operator');
  await ownerSuper.getByRole('button', { name: '권한 변경 저장', exact: true }).click();
  await expect.poll(() => patchBodies.length).toBe(5);
  await expect(ownerSuper.locator('.admin-post-status'))
    .toHaveText('현재 로그인한 최고관리자 자신의 권한은 여기서 낮추거나 해제할 수 없습니다.');

  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});


test('#615 SUPER global audit viewer is hidden from operators and renders only privacy-bounded summary fields', async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  const auditQueries: string[] = [];
  let authorityMode: 'admin' | 'operator' = 'operator';

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
      const admin = authorityMode === 'admin';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: admin
            ? { level: 'admin', label: '최고관리자', wildcard: true, scopes: ['*'] }
            : {
                level: 'operator',
                label: '일반관리자',
                wildcard: false,
                scopes: ['benefit.manage','business.review','official-content.manage','resident_news.review']
              }
        })
      });
      return;
    }

    if (url.pathname === '/api/v1/admin/audit-events' && method === 'GET') {
      auditQueries.push(url.search);
      const decision = url.searchParams.get('decision');
      const allRows = [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          actorKind: 'operator',
          action: 'admin.principal.update',
          scope: 'platform.authz.manage',
          resourceType: 'administrator-principal',
          decision: 'allowed',
          reasonCode: 'ADMIN_PRINCIPAL_UPDATED',
          createdAt: '2026-09-16T15:00:00.000Z',
          actorUserId: 'PII-SENTINEL-ACTOR',
          resourceId: 'PII-SENTINEL-RESOURCE',
          requestId: 'PII-SENTINEL-REQUEST',
          metadata: { email: 'PII-SENTINEL@example.com' }
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          actorKind: 'operator',
          action: 'authorization.padiem-authority-check',
          scope: 'platform.audit.read',
          resourceType: null,
          decision: 'denied',
          reasonCode: 'PRIVILEGED_WILDCARD_REQUIRED',
          createdAt: '2026-09-16T14:59:00.000Z'
        }
      ];
      const rows = decision ? allRows.filter(row => row.decision === decision) : allRows;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: rows })
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
  await expect(page.getByRole('heading', { name: '단지온 운영관리' })).toBeVisible();
  await expect(page.getByRole('button', { name: '최고관리', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '전체 감사 기록', exact: true })).toHaveCount(0);
  expect(auditQueries).toEqual([]);

  authorityMode = 'admin';
  await page.reload();
  await page.getByRole('button', { name: '최고관리', exact: true }).click();
  await page.getByRole('button', { name: '전체 감사 기록', exact: true }).click();

  await expect(page.getByRole('heading', { name: '전체 감사 기록', exact: true })).toBeVisible();
  await expect.poll(() => auditQueries.length).toBe(1);
  expect(new URLSearchParams(auditQueries[0]).get('limit')).toBe('100');

  const allowedCard = page.locator('.admin-card').filter({ hasText: 'admin.principal.update' });
  await expect(allowedCard).toBeVisible();
  await expect(allowedCard).toContainText('platform.authz.manage');
  await expect(allowedCard).toContainText('ADMIN_PRINCIPAL_UPDATED');
  await expect(allowedCard).toContainText('administrator-principal');
  await expect(allowedCard).toContainText('allowed');

  for (const sentinel of [
    'PII-SENTINEL-ACTOR',
    'PII-SENTINEL-RESOURCE',
    'PII-SENTINEL-REQUEST',
    'PII-SENTINEL@example.com'
  ]) {
    await expect(page.getByText(sentinel, { exact: false })).toHaveCount(0);
  }

  await page.getByLabel('감사 결정 필터').selectOption('denied');
  await expect.poll(() => auditQueries.length).toBe(2);
  expect(new URLSearchParams(auditQueries[1]).get('decision')).toBe('denied');
  await expect(page.locator('.admin-card')).toHaveCount(1);
  await expect(page.locator('.admin-card')).toContainText('authorization.padiem-authority-check');
  await expect(page.locator('.admin-card')).toContainText('PRIVILEGED_WILDCARD_REQUIRED');

  await page.getByRole('button', { name: '감사 기록 새로고침', exact: true }).click();
  await expect.poll(() => auditQueries.length).toBe(3);

  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// #767 (owner live QA round 2, from #762): the canonical community write screens
// used to render 말머리 selectors that never reached the server. This gate proves
// the acceptance criterion end to end inside a real browser: the selected 말머리 is
// visible on the write screen before submit, rides the canonical write payload, and
// is rendered back from server data on the published item.
test('#767 community write carries the selected 말머리 to the server and renders it back', async ({ page }) => {
  const POST_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
  const TITLE = '주차장 진입로 공사 문의';
  const BODY = '이번 주 진입로 공사 시간을 미리 알고 싶습니다.';
  const posted: any[] = [];
  const pageErrors: string[] = [];
  const unexpectedMutations: string[] = [];
  let stored: any = null;

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

    if (url.pathname === '/api/auth/get-session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { id: 'runtime-session', userId: 'runtime-member', expiresAt: '2099-01-01T00:00:00.000Z' },
          user: {
            id: 'runtime-member',
            name: '런타임 주민',
            email: 'runtime-member@example.invalid',
            emailVerified: true,
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        })
      });
      return;
    }

    if (url.pathname === '/api/auth/list-accounts') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ providerId: 'credential' }]) });
      return;
    }

    const community = '/api/v1/complexes/' + COMPLEX + '/community/posts';
    if (url.pathname === community && method === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      posted.push(body);
      stored = {
        id: POST_ID,
        kind: body.kind,
        category: body.category ?? null,
        title: body.title,
        body: body.body,
        status: 'pending_review',
        author: { nickname: '런타임 주민' },
        reactionCount: 0,
        commentCount: 0,
        viewerLiked: false,
        publishedAt: null,
        createdAt: '2026-09-16T12:00:00.000Z',
        updatedAt: '2026-09-16T12:00:00.000Z'
      };
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: stored }) });
      return;
    }

    if (url.pathname === community + '/' + POST_ID && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: stored }) });
      return;
    }

    if (url.pathname === community + '/' + POST_ID + '/comments' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
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

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });

  await page.goto(withApi('/16_궁금해요_글쓰기.html'));

  // 1. The selected 말머리 is visible on the write screen before submit.
  await expect(page.locator('[data-danjion-page="16"]')).toBeVisible();
  await expect(page.locator('#categoryChip')).toHaveText('궁금해요 · 생활·살림');
  await page.locator('.type-tab[data-type="단지시설"]').click();
  await expect(page.locator('.type-tab[data-type="단지시설"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#categoryChip')).toHaveText('궁금해요 · 단지시설');

  await page.locator('#title').fill(TITLE);
  await page.locator('#body').fill(BODY);
  await page.locator('.publish').click();

  // 2. The selected 말머리 rides the canonical server write payload.
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual({ kind: 'question', title: TITLE, body: BODY, category: '단지시설' });

  // 3. The stored server value is rendered back as the 말머리 on the detail screen.
  await page.waitForURL(url => url.searchParams.get('post') === POST_ID);
  await expect(page.locator('#typeLabel')).toHaveText('궁금해요 · 단지시설');
  await expect(page.locator('#title')).toHaveText(TITLE);
  await expect(page.locator('#body')).toHaveText(BODY);
  await expect(page.locator('#interactionStatus')).toContainText('공개 전 확인 대기 중');

  expect(unexpectedMutations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// #767: every 함께해요 activity type must map onto its own canonical server category.
// Collapsing the four types into one generic value was the reported defect.
test('#767 together write exposes each canonical 유형 as an exact 말머리', async ({ page }) => {
  const CANONICAL: Array<[string, string]> = [
    ['walk', '산책·운동'],
    ['hobby', '취미활동'],
    ['parent', '육아 같이해요'],
    ['group', '공동구매'],
    ['dog', '강아지 산책 같이해요']
  ];

  await page.goto(withApi('/17_같이해요_글쓰기.html'));
  await expect(page.locator('[data-danjion-page="17"]')).toBeVisible();
  await expect(page.locator('.type-tab')).toHaveCount(CANONICAL.length);

  for (const [kind, category] of CANONICAL) {
    await page.locator('.type-tab[data-kind="' + kind + '"]').click();
    await expect(page.locator('.type-tab[data-kind="' + kind + '"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#categoryChip')).toHaveText('같이해요 · ' + category);
  }

  // The additive 5th 유형 must not degrade the tab strip: one row on desktop, no
  // accepted-label truncation, and usable hit targets.
  const boxes = await page.locator('.type-tab').evaluateAll(tabs =>
    tabs.map(tab => tab.getBoundingClientRect())
  );
  expect(boxes).toHaveLength(CANONICAL.length);
  for (const box of boxes) {
    expect(Math.abs(box.top - boxes[0].top), 'all five 유형 stay on one row').toBeLessThan(2);
    expect(box.height, 'tab hit target height').toBeGreaterThanOrEqual(44);
    expect(box.width, 'tab cell width').toBeGreaterThanOrEqual(100);
  }
  const overflow = await page.locator('.type-tabs').evaluate(nav => ({
    scroll: nav.scrollWidth,
    client: nav.clientWidth
  }));
  expect(overflow.scroll, 'tab strip must not overflow horizontally').toBeLessThanOrEqual(overflow.client + 1);
  expect(overflow.client, 'tab strip uses the full app column').toBeGreaterThanOrEqual(320);

  // Mobile keeps the same five 유형 in two columns with explicit cell separators
  // (rows 1-2 above a divider, the lone fifth cell closed).
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.type-tab').evaluateAll(tabs => tabs.map(tab => {
    const rect = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    return {
      top: rect.top,
      height: rect.height,
      borderRight: style.borderRightWidth,
      borderBottom: style.borderBottomWidth
    };
  }));
  expect(mobile).toHaveLength(CANONICAL.length);
  expect(mobile[0].top).toBe(mobile[1].top);
  expect(mobile[2].top).toBe(mobile[3].top);
  expect(mobile[4].top, 'the additive fifth 유형 starts its own mobile row').toBeGreaterThan(mobile[3].top);
  expect(mobile[0].borderRight, 'left column keeps its cell divider').toBe('1px');
  expect(mobile[1].borderRight, 'right column never trails a divider').toBe('0px');
  expect(mobile[2].borderRight).toBe('1px');
  expect(mobile[3].borderRight).toBe('0px');
  expect(mobile[4].borderRight, 'the lone last cell closes the grid instead of dividing an empty cell').toBe('0px');
  expect(mobile[1].borderBottom, 'the first row keeps its divider').toBe('1px');
  expect(mobile[3].borderBottom, 'the populated second row keeps its divider').toBe('1px');
  expect(mobile[4].borderBottom, 'the lone last cell closes the grid').toBe('0px');
  for (const tab of mobile) expect(tab.height).toBeGreaterThanOrEqual(44);
});
