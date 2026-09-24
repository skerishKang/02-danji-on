import { test, expect, type Page } from '@playwright/test';

const PORT = process.env.DANJION_E2E_PORT || '4174';
const BASE = `http://127.0.0.1:${PORT}`;
const COMPLEX = 'banglim-myeongji-roadhill';
const POST_ID = 'a0a1c4a1-1111-4111-8111-111111111111';
const COMMENT_A = 'b0a1c4a1-2222-4222-8222-222222222222';
const COMMENT_B = 'c0a1c4a1-3333-4333-8333-333333333333';
const REPLY_ID = 'd0a1c4a1-4444-4444-8444-444444444444';
const POST = {
  id: POST_ID,
  kind: 'question',
  category: '생활·살림',
  title: '390px 답글 폰 접근성 검증',
  body: '모바일 답글 입력과 포커스 흐름을 확인합니다.',
  status: 'published',
  author: { nickname: '글쓴이' },
  reactionCount: 0,
  commentCount: 2,
  viewerLiked: false,
  viewerCanEdit: false,
  viewerCanDelete: false,
  viewerCanReport: true,
  publishedAt: '2026-09-22T00:00:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z'
};
const COMMENTS = [
  {
    id: COMMENT_A,
    postId: POST_ID,
    body: '첫 번째 댓글입니다.',
    status: 'published',
    author: { nickname: '답글대상甲' },
    viewerCanDelete: false,
    viewerCanReport: true,
    publishedAt: '2026-09-22T00:01:00.000Z',
    createdAt: '2026-09-22T00:01:00.000Z',
    updatedAt: '2026-09-22T00:01:00.000Z'
  },
  {
    id: COMMENT_B,
    postId: POST_ID,
    body: '두 번째 댓글입니다.',
    status: 'published',
    author: { nickname: '답글대상乙' },
    viewerCanDelete: false,
    viewerCanReport: true,
    publishedAt: '2026-09-22T00:02:00.000Z',
    createdAt: '2026-09-22T00:02:00.000Z',
    updatedAt: '2026-09-22T00:02:00.000Z'
  }
];

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function installCommunityMock(page: Page) {
  const pageErrors: string[] = [];
  const replyPosts: Array<{ parentId: string; body: string }> = [];
  let failNextReply = false;
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.origin !== BASE) {
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
      await route.fulfill(json([{ providerId: 'credential' }]));
      return;
    }

    const community = `/api/v1/complexes/${COMPLEX}/community`;
    if (url.pathname === `${community}/posts/${POST_ID}` && method === 'GET') {
      await route.fulfill(json({ data: POST }));
      return;
    }
    if (url.pathname === `${community}/posts/${POST_ID}/comments` && method === 'GET') {
      await route.fulfill(json({ data: COMMENTS, nextCursor: null, hasMore: false }));
      return;
    }

    const replyPath = new RegExp(`^${community}/posts/${POST_ID}/comments/([0-9a-f-]+)/replies$`, 'i');
    const replyMatch = url.pathname.match(replyPath);
    if (replyMatch && method === 'GET') {
      await route.fulfill(json({ data: [], nextCursor: null, hasMore: false }));
      return;
    }
    if (replyMatch && method === 'POST') {
      const payload = JSON.parse(request.postData() || '{}') as { body?: string };
      replyPosts.push({ parentId: replyMatch[1], body: String(payload.body || '') });
      if (failNextReply) {
        failNextReply = false;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'REPLY_TEST_FAILURE' } })
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: REPLY_ID,
            postId: POST_ID,
            parentCommentId: replyMatch[1],
            body: String(payload.body || ''),
            status: 'published',
            author: { nickname: '런타임 주민' },
            viewerCanDelete: true,
            viewerCanReport: false,
            publishedAt: '2026-09-22T00:03:00.000Z',
            createdAt: '2026-09-22T00:03:00.000Z',
            updatedAt: '2026-09-22T00:03:00.000Z'
          }
        })
      });
      return;
    }

    await route.fulfill(json({ data: [] }));
  });

  return { pageErrors, replyPosts, failNextReply: () => { failNextReply = true; } };
}

function pageUrl(): string {
  return `/13_이웃대화_글상세_댓글.html?post=${POST_ID}&apiBase=${encodeURIComponent(BASE)}`;
}

async function expectMinimumHeight(locator: ReturnType<Page['locator']>, label: string) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} must have a measurable box`).not.toBeNull();
  expect(box!.height, `${label} touch target`).toBeGreaterThanOrEqual(44);
}

test('#981 canonical Community reply form is labelled, keyboard-safe, and mobile-usable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await installCommunityMock(page);
  await page.goto(pageUrl(), { waitUntil: 'load' });

  await expect(page.locator('body[data-danjion-page="13"]')).toBeVisible();
  await expect(page.locator('[data-server-comment]')).toHaveCount(2);
  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const counts = new Map<string, number>();
    for (const element of elements) {
      const id = element.id;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1);
  });
  expect(duplicateIds, 'dynamic reply input IDs must not collide').toEqual([]);

  const firstTrigger = page.locator(`[data-server-reply="${COMMENT_A}"]`);
  const firstToggle = page.locator(`[data-server-reply-toggle="${COMMENT_A}"]`);
  await expectMinimumHeight(firstTrigger, 'reply open trigger');
  await expectMinimumHeight(firstToggle, 'reply list toggle');

  // Initialize the existing lazy reply state before the successful submit path.
  await firstToggle.click();
  await expect(page.locator(`[data-server-replies="${COMMENT_A}"] .reply-empty`)).toHaveText('답글이 없습니다.');

  const firstForm = page.locator(`[data-server-reply-form="${COMMENT_A}"]`);
  await firstTrigger.click();
  await expect(firstForm).toHaveClass(/open/);
  const firstInput = page.getByRole('textbox', { name: '답글대상甲님에게 답글', exact: true });
  const firstInputById = page.locator(`#reply-input-${COMMENT_A}`);
  await expect(firstInputById).toHaveAttribute('aria-label', '답글대상甲님에게 답글');
  await expect(firstInputById).toHaveAttribute('placeholder', '답글대상甲님에게 답글');
  await expect(page.locator(`label[for="reply-input-${COMMENT_A}"]`)).toHaveText('답글대상甲님에게 답글');
  const firstSubmit = firstForm.getByRole('button', { name: '등록', exact: true });
  const firstCancel = firstForm.getByRole('button', { name: '취소', exact: true });
  await expectMinimumHeight(firstInput, 'reply input');
  await expectMinimumHeight(firstSubmit, 'reply submit');
  await expectMinimumHeight(firstCancel, 'reply cancel');

  // Keyboard-only cancel lifecycle.
  await expect(firstInput).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstSubmit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstCancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(firstForm).not.toHaveClass(/open/);
  await expect(firstTrigger).toBeFocused();

  // Failed submit keeps the input focused and preserves the entered text.
  await firstTrigger.click();
  await expect(firstInput).toBeFocused();
  await firstInput.fill('실패 경로 입력값');
  mock.failNextReply();
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.replyPosts.length).toBe(1);
  await expect(firstInput).toBeFocused();
  await expect(firstInput).toHaveValue('실패 경로 입력값');

  // Successful submit keeps the existing endpoint/payload and restores focus.
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.replyPosts.length).toBe(2);
  expect(mock.replyPosts).toEqual([
    { parentId: COMMENT_A, body: '실패 경로 입력값' },
    { parentId: COMMENT_A, body: '실패 경로 입력값' }
  ]);
  await expect(firstForm).not.toHaveClass(/open/);
  await expect(firstInputById).toHaveValue('');
  await expect(firstTrigger).toBeFocused();
  await expect(page.locator(`[data-server-reply-id="${REPLY_ID}"]`)).toContainText('실패 경로 입력값');

  // Base 68px contract remains intact, then an injected 24px inset adds exactly.
  const baseGeometry = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom') as HTMLElement;
    const actions = document.querySelector('.actions') as HTMLElement;
    return {
      navHeight: nav.getBoundingClientRect().height,
      bodyPaddingBottom: parseFloat(getComputedStyle(document.body).paddingBottom),
      actionsBottom: parseFloat(getComputedStyle(actions).bottom)
    };
  });
  expect(baseGeometry).toEqual({ navHeight: 68, bodyPaddingBottom: 68, actionsBottom: 68 });

  await page.evaluate(() => document.documentElement.style.setProperty('--community-safe-bottom', '24px'));
  const insetGeometry = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom') as HTMLElement;
    const actions = document.querySelector('.actions') as HTMLElement;
    const child = nav.querySelector('a,button') as HTMLElement;
    return {
      navHeight: nav.getBoundingClientRect().height,
      navPaddingBottom: parseFloat(getComputedStyle(nav).paddingBottom),
      bodyPaddingBottom: parseFloat(getComputedStyle(document.body).paddingBottom),
      actionsBottom: parseFloat(getComputedStyle(actions).bottom),
      childHeight: child.getBoundingClientRect().height
    };
  });
  expect(insetGeometry).toEqual({ navHeight: 92, navPaddingBottom: 24, bodyPaddingBottom: 92, actionsBottom: 92, childHeight: 67 });

  await page.locator('.actions').scrollIntoViewIfNeeded();
  const stickyGeometry = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom')!.getBoundingClientRect();
    const actions = document.querySelector('.actions')!.getBoundingClientRect();
    return { actionBottom: actions.bottom, navTop: nav.top };
  });
  expect(stickyGeometry.actionBottom, 'sticky actions must not overlap fixed bottom navigation').toBeLessThanOrEqual(stickyGeometry.navTop + 1);

  // Approximate a reduced software-keyboard viewport: the focused input must be
  // scrolled into the usable area and remain above the fixed bottom navigation.
  await page.setViewportSize({ width: 390, height: 500 });
  await firstTrigger.click();
  await expect(firstInput).toBeFocused();
  await expect.poll(async () => page.evaluate((inputSelector) => {
    const input = document.querySelector(inputSelector)!.getBoundingClientRect();
    const nav = document.querySelector('.mobile-bottom')!.getBoundingClientRect();
    return input.top >= 0 && input.bottom <= nav.top + 1;
  }, `#reply-input-${COMMENT_A}`)).toBe(true);

  expect(mock.pageErrors, 'canonical Community detail must load without runtime errors').toEqual([]);
});
