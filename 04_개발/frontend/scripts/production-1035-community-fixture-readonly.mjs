import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';

const FRONTEND = 'https://danjion.pages.dev';
const COMPLEX = 'banglim-myeongji-roadhill';
const MAX_PAGES = 20;
const PAGE_LIMIT = 50;

const HISTORICAL_POSTS = new Map([
  ['e859b798-77d2-476c-b9d5-e5b34b3995d7', '#810_GREETING'],
  ['61e2f88d-02b3-4ec2-a43f-73f8c1e079ef', '#810_STORY'],
  ['ab92e2cb-cdd3-4d55-9dd6-721df92e3a86', '#810_QUESTION'],
  ['a8a7888f-398a-4218-908c-a9d11c5cb3ca', '#810_TOGETHER'],
  ['79adbc1a-e526-4803-b3da-051521738991', '#924_POST_A'],
  ['e46e6399-cb30-4f44-bf82-ad1adb06fc4b', '#924_POST_B'],
]);
const HISTORICAL_COMMENTS = new Map([
  ['61544b52-9460-4af8-992f-31eed224d1f0', '#810_COMMENT'],
  ['b0804583-0ec1-496e-b72c-d34b3adebdd6', '#810_REPLY'],
  ['dfc69dfd-17fe-4eb5-b531-53914d818407', '#924_COMMENT_A'],
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function sha(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function markerFamilies(value) {
  const s = String(value ?? '').toUpperCase();
  const out = [];
  if (s.includes('QA-SUPER-VERIFY')) out.push('QA_SUPER_VERIFY');
  if (s.includes('QA #830') || s.includes('QA830') || s.includes('QA-830')) out.push('QA_830');
  if (s.includes('QA-810') || s.includes('QA #810') || s.includes('QA810')) out.push('QA_810');
  if (s.includes('[QA]')) out.push('QA_GENERIC');
  if (s.includes('UI 댓글 검증용입니다.'.toUpperCase())) out.push('AUDIT_UI_COMMENT');
  if (s.includes('댓글 등록 핸들러 검증'.toUpperCase())) out.push('AUDIT_COMMENT_HANDLER');
  if (s.includes('답글 등록 핸들러 검증'.toUpperCase())) out.push('AUDIT_REPLY_HANDLER');
  return out;
}

function candidateMeta(row) {
  const exactHistoricalAnchor = HISTORICAL_POSTS.get(String(row?.id || '').toLowerCase()) || null;
  const marker = [...new Set([...markerFamilies(row?.title), ...markerFamilies(row?.body)])];
  return { exactHistoricalAnchor, marker };
}

async function getJson(request, path) {
  const response = await request.get(`${FRONTEND}${path}`, {
    headers: { accept: 'application/json', Origin: FRONTEND },
    timeout: 15_000,
  });
  if (response.status() !== 200) throw new Error(`GET_FAILED:${path}:HTTP_${response.status()}`);
  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.data)) throw new Error(`GET_BODY_INVALID:${path}`);
  return body;
}

async function allPages(request, basePath) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const path = `${basePath}${basePath.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const body = await getJson(request, path);
    rows.push(...body.data);
    if (!body.hasMore) return rows;
    if (!body.nextCursor) throw new Error(`PAGINATION_CURSOR_MISSING:${basePath}`);
    cursor = String(body.nextCursor);
  }
  throw new Error(`PAGINATION_BOUND_EXCEEDED:${basePath}`);
}

function safePost(row, meta) {
  return {
    type: 'post',
    id: String(row.id),
    kind: String(row.kind || ''),
    status: String(row.status || ''),
    createdAt: row.createdAt || null,
    publishedAt: row.publishedAt || null,
    commentCount: Number(row.commentCount || 0),
    reactionCount: Number(row.reactionCount || 0),
    residentVisible: true,
    apartmentScope: COMPLEX,
    exactHistoricalAnchor: meta.exactHistoricalAnchor,
    markerFamilies: meta.marker,
    ownedByTestResident: Boolean(row.viewerCanDelete || row.viewerCanEdit),
    authorFingerprint: sha(row?.author?.nickname),
  };
}

function safeComment(row, postId, type = 'comment') {
  const id = String(row?.id || '').toLowerCase();
  return {
    type,
    id,
    postId,
    parentCommentId: row?.parentCommentId || null,
    status: String(row?.status || ''),
    createdAt: row?.createdAt || null,
    publishedAt: row?.publishedAt || null,
    residentVisible: true,
    apartmentScope: COMPLEX,
    exactHistoricalAnchor: HISTORICAL_COMMENTS.get(id) || null,
    markerFamilies: markerFamilies(row?.body),
    ownedByTestResident: type === 'comment' ? Boolean(row.viewerCanDelete) : null,
    authorFingerprint: sha(row?.author?.nickname),
  };
}

const email = required('DANJION_PRODUCTION_TEST_RESIDENT_EMAIL');
const password = required('DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD');
if (password.length < 8) throw new Error('PRODUCTION_TEST_RESIDENT_PASSWORD_INVALID');

let browser;
let context;
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();

  const signin = await context.request.post(`${FRONTEND}/api/auth/sign-in/email`, {
    headers: { Origin: FRONTEND, 'Content-Type': 'application/json' },
    data: { email, password },
    timeout: 15_000,
  });
  if (signin.status() !== 200) throw new Error(`SIGNIN_HTTP_${signin.status()}`);

  const session = await context.request.get(`${FRONTEND}/api/auth/get-session`, {
    headers: { Origin: FRONTEND, accept: 'application/json' }, timeout: 15_000,
  });
  if (session.status() !== 200) throw new Error(`SESSION_HTTP_${session.status()}`);
  const sessionBody = await session.json().catch(() => null);
  if (!sessionBody?.session || !sessionBody?.user) throw new Error('SESSION_NOT_AUTHENTICATED');
  console.log('PRODUCTION_1035_TEST_RESIDENT_SIGNIN=PASS');

  const posts = await allPages(context.request, `/api/v1/complexes/${COMPLEX}/community/posts`);
  const candidates = [];
  for (const post of posts) {
    const meta = candidateMeta(post);
    if (!meta.exactHistoricalAnchor && meta.marker.length === 0) continue;
    const safe = safePost(post, meta);
    const comments = await allPages(context.request, `/api/v1/complexes/${COMPLEX}/community/posts/${safe.id}/comments`);
    const nested = [];
    for (const comment of comments) {
      const safeTop = safeComment(comment, safe.id, 'comment');
      const replies = await allPages(context.request, `/api/v1/complexes/${COMPLEX}/community/posts/${safe.id}/comments/${safeTop.id}/replies`);
      nested.push(safeTop, ...replies.map((reply) => safeComment(reply, safe.id, 'reply')));
    }
    candidates.push({ post: safe, commentsAndReplies: nested });
  }

  const historicalVisible = new Set(candidates.map((entry) => entry.post.id));
  const missingHistoricalPosts = [...HISTORICAL_POSTS.entries()]
    .filter(([id]) => !historicalVisible.has(id))
    .map(([id, anchor]) => ({ id, anchor }));

  console.log(`PRODUCTION_1035_FEED_ROWS_SCANNED=${posts.length}`);
  console.log(`PRODUCTION_1035_CANDIDATE_POST_COUNT=${candidates.length}`);
  console.log(`PRODUCTION_1035_HISTORICAL_POSTS_NOT_VISIBLE_COUNT=${missingHistoricalPosts.length}`);
  console.log(`PRODUCTION_1035_INVENTORY=${JSON.stringify({ candidates, missingHistoricalPosts })}`);
  console.log('PRODUCTION_1035_PRODUCT_DATA_MUTATION=0');
  console.log('PRODUCTION_1035_DB_DIRECT_ACCESS=0');
  console.log('PRODUCTION_1035_SECRET_OUTPUT=0');
} catch (error) {
  const code = String(error instanceof Error ? error.message : error).replace(/[^A-Za-z0-9_:/.-]/g, '_').slice(0, 220);
  console.error(`PRODUCTION_1035_READONLY_FAILED=${code}`);
  console.log('PRODUCTION_1035_PRODUCT_DATA_MUTATION=0');
  console.log('PRODUCTION_1035_DB_DIRECT_ACCESS=0');
  console.log('PRODUCTION_1035_SECRET_OUTPUT=0');
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}
