import { expect, test, type Page, type Route } from '@playwright/test';

const COMPLEX = 'bangnim-myeongji-roadhill';
const COMMUNITY_POSTS = `/api/v1/complexes/${COMPLEX}/community/posts`;
const OFFICIAL_POSTS = `/api/v1/complexes/${COMPLEX}/posts`;
const RESIDENT_ID = '40000000-0000-4000-8000-000000000001';

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status >= 400 ? data : { data, requestId: 'pw-community-api' })
  });
}

async function openCommunity(page: Page) {
  await page.goto('/');
  await page.locator('[data-v2-topbar] nav[aria-label="주요 메뉴"]').getByRole('button', { name: '우리단지', exact: true }).click();
  const hub = page.locator('[data-v2-complex-hub]');
  await expect(hub).toBeVisible();
  await hub.getByRole('button', { name: '이웃대화 들어가기', exact: true }).click();
}

test.describe('Community C6 API-mode browser gate', () => {
  test('403 resident probe keeps Neighbor Conversation locked and carries dev resident identity', async ({ page }) => {
    let residentProbeHeader = '';

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === COMMUNITY_POSTS) {
        residentProbeHeader = request.headers()['x-danjion-dev-auth-user'] ?? '';
        return json(route, {
          error: {
            code: 'RESIDENT_VERIFICATION_REQUIRED',
            message: 'Verified resident required'
          }
        }, 403);
      }
      return json(route, []);
    });

    await openCommunity(page);

    await expect(page.getByRole('heading', { name: '이웃대화는 입주민 확인 후 이용합니다.' })).toBeVisible();
    await expect(page.getByText(/소셜 로그인이나 과거 관리권한만으로 주민 글과 댓글 권한을 부여하지 않습니다/)).toBeVisible();
    expect(residentProbeHeader).toBe('dev-resident-001');
  });

  test('200 resident probe renders resident-only feed and sends resident mutations to Community API', async ({ page }) => {
    const seen: Array<{ method: string; path: string; auth: string; body: unknown }> = [];
    let liked = false;
    const comments = [
      {
        id: '50000000-0000-4000-8000-000000000001',
        postId: RESIDENT_ID,
        body: '기존 댓글입니다.',
        status: 'published',
        author: { nickname: '기존이웃' },
        publishedAt: '2026-08-30T10:00:00Z',
        createdAt: '2026-08-30T10:00:00Z',
        updatedAt: '2026-08-30T10:00:00Z'
      }
    ];

    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      let body: unknown = null;
      if (request.postData()) {
        try { body = request.postDataJSON(); } catch { body = request.postData(); }
      }
      seen.push({
        method,
        path: url.pathname,
        auth: request.headers()['x-danjion-dev-auth-user'] ?? '',
        body
      });

      if (method === 'GET' && url.pathname === COMMUNITY_POSTS) {
        return json(route, [{
          id: RESIDENT_ID,
          kind: 'question',
          title: 'API 주민 질문',
          body: '서버에서 온 주민 글입니다.',
          status: 'published',
          author: { nickname: 'API이웃' },
          reactionCount: liked ? 3 : 2,
          commentCount: comments.length,
          viewerLiked: liked,
          publishedAt: '2026-08-30T11:00:00Z',
          createdAt: '2026-08-30T11:00:00Z',
          updatedAt: '2026-08-30T11:00:00Z'
        }]);
      }

      if (method === 'GET' && url.pathname === OFFICIAL_POSTS) {
        return json(route, [{
          id: 'official-api-1',
          source_name: '관리사무소 공식',
          category: '공지',
          title: 'API 공식 공지',
          body: 'public complex_posts 경계의 공식 글입니다.',
          published_at: '2026-08-30T09:00:00Z'
        }]);
      }

      if (method === 'GET' && url.pathname === `${COMMUNITY_POSTS}/${RESIDENT_ID}/comments`) {
        return json(route, comments);
      }

      if (method === 'POST' && url.pathname === `${COMMUNITY_POSTS}/${RESIDENT_ID}/comments`) {
        const text = String((body as { body?: unknown } | null)?.body ?? '');
        const created = {
          id: '50000000-0000-4000-8000-000000000002',
          postId: RESIDENT_ID,
          body: text,
          status: 'published',
          author: { nickname: '온이웃' },
          publishedAt: '2026-08-30T12:00:00Z',
          createdAt: '2026-08-30T12:00:00Z',
          updatedAt: '2026-08-30T12:00:00Z'
        };
        comments.push(created);
        return json(route, created, 201);
      }

      if (url.pathname === `${COMMUNITY_POSTS}/${RESIDENT_ID}/reactions` && (method === 'POST' || method === 'DELETE')) {
        liked = method === 'POST';
        return json(route, { postId: RESIDENT_ID, reactionType: 'like', active: liked });
      }

      if (method === 'POST' && url.pathname === `/api/v1/complexes/${COMPLEX}/community/reports`) {
        return json(route, { id: '60000000-0000-4000-8000-000000000001', status: 'submitted', createdAt: '2026-08-30T12:10:00Z' }, 201);
      }

      if (method === 'POST' && url.pathname === COMMUNITY_POSTS) {
        const input = body as { kind?: string; title?: string; body?: string };
        return json(route, {
          id: '40000000-0000-4000-8000-000000000002',
          kind: input.kind ?? 'question',
          title: input.title ?? '',
          body: input.body ?? '',
          status: 'published',
          author: { nickname: '온이웃' },
          reactionCount: 0,
          commentCount: 0,
          viewerLiked: false,
          publishedAt: '2026-08-30T12:20:00Z',
          createdAt: '2026-08-30T12:20:00Z',
          updatedAt: '2026-08-30T12:20:00Z'
        }, 201);
      }

      return json(route, []);
    });

    await openCommunity(page);

    const community = page.locator('.v2-community-layer');
    await expect(community.getByRole('heading', { name: '이웃대화', exact: true })).toBeVisible();
    await expect(community.getByText('API 공식 공지', { exact: true })).toHaveCount(0);

    const questionTopic = community.locator('.v2-community-topic').filter({ hasText: '궁금해요' });
    await questionTopic.click();
    await expect(community.getByText('API 주민 질문', { exact: true })).toBeVisible();

    const residentProbe = seen.find((item) => item.method === 'GET' && item.path === COMMUNITY_POSTS);
    expect(residentProbe?.auth).toBe('dev-resident-001');
    expect(seen.find((item) => item.method === 'GET' && item.path === OFFICIAL_POSTS)).toBeUndefined();

    await community.getByText('API 주민 질문', { exact: true }).click();
    await expect(page.getByText('기존 댓글입니다.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^♡ 공감/ }).click();
    await expect(page.getByRole('button', { name: /^♥ 공감 취소/ })).toBeVisible();
    await page.getByRole('button', { name: /^♥ 공감 취소/ }).click();
    await expect(page.getByRole('button', { name: /^♡ 공감/ })).toBeVisible();

    await page.getByRole('button', { name: /^댓글/ }).click();
    await page.getByRole('textbox', { name: '댓글' }).fill('API 모드 댓글입니다.');
    await page.getByRole('button', { name: '댓글 등록', exact: true }).click();
    await expect(page.getByText('API 모드 댓글입니다.', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '신고하기', exact: true }).click();
    await expect(page.getByText(/신고가 접수되었습니다/)).toBeVisible();

    await page.getByRole('button', { name: '게시물 닫기', exact: true }).click();
    await expect(community.getByRole('button', { name: /궁금해요 글쓰기/ })).toBeVisible();
    await community.getByRole('button', { name: /궁금해요 글쓰기/ }).click();
    await page.getByRole('textbox', { name: '질문 제목' }).fill('새 API 질문');
    await page.getByRole('textbox', { name: '궁금한 내용' }).fill('브라우저에서 Community API로 등록합니다.');
    await page.getByRole('button', { name: '질문 게시하기', exact: true }).click();
    await expect(community.getByText('새 API 질문', { exact: true })).toBeVisible();

    const requiredMutations = [
      ['POST', `${COMMUNITY_POSTS}/${RESIDENT_ID}/reactions`],
      ['DELETE', `${COMMUNITY_POSTS}/${RESIDENT_ID}/reactions`],
      ['POST', `${COMMUNITY_POSTS}/${RESIDENT_ID}/comments`],
      ['POST', `/api/v1/complexes/${COMPLEX}/community/reports`],
      ['POST', COMMUNITY_POSTS]
    ];

    for (const [method, path] of requiredMutations) {
      const hit = seen.find((item) => item.method === method && item.path === path);
      expect(hit, `${method} ${path} should be requested`).toBeTruthy();
      expect(hit?.auth).toBe('dev-resident-001');
    }

    expect(seen.find((item) => item.method === 'POST' && item.path === `${COMMUNITY_POSTS}/${RESIDENT_ID}/comments`)?.body).toEqual({ body: 'API 모드 댓글입니다.' });
    expect(seen.find((item) => item.method === 'POST' && item.path === `/api/v1/complexes/${COMPLEX}/community/reports`)?.body).toEqual({
      targetType: 'post',
      targetId: RESIDENT_ID,
      reason: 'other',
      detail: 'Product Shell resident report'
    });
    expect(seen.find((item) => item.method === 'POST' && item.path === COMMUNITY_POSTS)?.body).toEqual({
      kind: 'question',
      title: '새 API 질문',
      body: '브라우저에서 Community API로 등록합니다.'
    });
  });
});