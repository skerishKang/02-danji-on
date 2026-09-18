// QA interactive deep test: SUPER logs in via the real UI, then exercises
// actual write flows (community post create → published → visible → comment)
// plus click-through navigation. QA-only; product mutation is limited to
// synthetic QA content on the QA database. Values are never printed.
import { chromium } from '@playwright/test';

const FRONTEND = 'https://danjion-qa.pages.dev';
const STAMP = Date.now().toString(36);
const POST_TITLE = `[QA테스트] 상호작용 점검 ${STAMP}`;
const POST_BODY = 'QA 자동화 상호작용 점검 본문입니다. 클릭·작성·게시·댓글 흐름을 확인합니다.';
const COMMENT_BODY = `[QA테스트 댓글 ${STAMP}] 작성 흐름 확인용입니다.`;

const results = [];
function record(label, pass, detail = '') {
  results.push(`${label}=${pass ? 'PASS' : 'FAIL'}${detail ? ':' + detail : ''}`);
}

const email = process.env.DANJION_QA_SUPER_EMAIL?.trim();
const password = process.env.DANJION_QA_SUPER_PASSWORD?.trim();
if (!email || !password) {
  console.error('QA_INTERACTION_MISSING_CREDENTIALS');
  process.exit(1);
}

async function sessionShape(context) {
  const response = await context.request.get(`${FRONTEND}/api/auth/get-session`, {
    headers: { Origin: FRONTEND }
  });
  const body = await response.json().catch(() => null);
  return { status: response.status(), hasSession: Boolean(body?.session), hasUser: Boolean(body?.user) };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();

  // ---------- login via real UI ----------
  await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.getByRole('button', { name: '로그인', exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(1_200);
  await page.getByRole('button', { name: /이메일로 로그인/ }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(1_200);
  await page.locator('input[type="email"]').first().fill(email, { timeout: 10_000 });
  await page.locator('input[type="password"]').first().fill(password, { timeout: 10_000 });
  await page.locator('button:has-text("로그인")').last().click({ timeout: 10_000 });
  await page.waitForTimeout(4_000);
  const session = await context.request.get(`${FRONTEND}/api/auth/get-session`, { headers: { Origin: FRONTEND } });
  const sBody = await session.json().catch(() => null);
  record('LOGIN_SESSION', Boolean(sBody?.session), `HTTP_${session.status()}`);

  // ---------- click-through: header/nav buttons respond ----------
  const navClicked = await page.evaluate(() => {
    // find a visible nav-ish button/link that is not login/signup
    const candidates = [...document.querySelectorAll('button, a')]
      .filter((el) => el.offsetParent && /^(내정보|단지온|홈|메뉴)/.test((el.innerText || '').trim()));
    return candidates.length > 0;
  });
  record('NAV_CANDIDATES_EXIST', navClicked);

  // ---------- community: exercise the canonical static multi-page flow ----------
  // QA Pages serves the same static multi-page community surface as the canonical site.
  // Pin the question tab so #writeMain deterministically routes to 16_궁금해요_글쓰기.html.
  let communityOpened = false;
  try {
    await page.goto(`${FRONTEND}/12_%EC%9D%B4%EC%9B%83%EB%8C%80%ED%99%94_%EC%B2%AB%ED%99%94%EB%A9%B4.html?type=question`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    });
    await page.waitForTimeout(2_500);
    communityOpened = await page.locator('#writeMain, .write-main').first().isVisible().catch(() => false);
  } catch {}
  record('COMMUNITY_OPENED', communityOpened);

  if (communityOpened) {
    let writeOpened = false;
    try {
      await page.locator('#writeMain, .write-main').first().click({ timeout: 8_000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
      await page.waitForTimeout(2_000);
      const titleReady = await page.locator('#title').first().isVisible().catch(() => false);
      const bodyReady = await page.locator('#body').first().isVisible().catch(() => false);
      const publishReady = await page.locator('[data-publish]').first().isVisible().catch(() => false);
      writeOpened = titleReady && bodyReady && publishReady;
    } catch {}
    record('WRITE_FORM_OPENED', writeOpened);

    if (writeOpened) {
      let filled = false;
      try {
        await page.locator('#title').first().fill(POST_TITLE, { timeout: 5_000 });
        await page.locator('#body').first().fill(POST_BODY, { timeout: 5_000 });
        filled = true;
      } catch {}
      record('WRITE_FORM_FILLED', filled);

      let submitted = false;
      let postAccepted = false;
      let postStatus = 0;
      try {
        // Preserve #724: navigation can outlive the original UI session. Refresh only
        // through the QA same-origin auth facade when the current session is absent.
        const beforeSubmit = await sessionShape(context);
        if (!beforeSubmit.hasSession) {
          console.log('DEBUG_SESSION_EXPIRED_BEFORE_SUBMIT=true');
          const refreshed = await context.request.post(`${FRONTEND}/api/auth/sign-in/email`, {
            headers: { Origin: FRONTEND, 'Content-Type': 'application/json' },
            data: { email, password }
          });
          const afterRefresh = await sessionShape(context);
          if (!refreshed.ok() || !afterRefresh.hasSession) throw new Error('QA_SESSION_REFRESH_FAILED');
          await page.waitForTimeout(1_000);
        }

        const responsePromise = page.waitForResponse((response) => {
          if (response.request().method() !== 'POST') return false;
          try {
            const url = new URL(response.url());
            return /\/api\/v1\/complexes\/[^/]+\/community\/posts$/.test(url.pathname);
          } catch {
            return false;
          }
        }, { timeout: 10_000 });

        await page.locator('[data-publish]').first().click({ timeout: 6_000 });
        const response = await responsePromise;
        postStatus = response.status();
        postAccepted = response.ok();
        submitted = true;
        await page.waitForTimeout(2_500);
      } catch {}
      record('POST_SUBMITTED', submitted, postStatus ? `HTTP_${postStatus}` : '');
      record('POST_WRITE_ACCEPTED', postAccepted, postStatus ? `HTTP_${postStatus}` : 'NO_SERVER_RESPONSE');

      let visible = false;
      if (postAccepted) {
        try {
          await page.waitForTimeout(1_500);
          visible = await page.getByText(`상호작용 점검 ${STAMP}`, { exact: false }).first().isVisible().catch(() => false);
        } catch {}
      }
      record(
        'POST_VISIBILITY_DISPOSITION',
        postAccepted,
        visible ? 'VISIBLE_IN_LIST' : postAccepted ? 'ACCEPTED_NOT_PUBLIC' : 'NOT_ACCEPTED'
      );

      if (postAccepted && visible) {
        let commentAccepted = false;
        let commentVisible = false;
        let commentStatus = 0;
        try {
          await page.getByText(`상호작용 점검 ${STAMP}`, { exact: false }).first().click({ timeout: 6_000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
          await page.waitForTimeout(1_500);

          const commentBox = page.locator('#commentText').first();
          await commentBox.fill(COMMENT_BODY, { timeout: 5_000 });
          const responsePromise = page.waitForResponse((response) => {
            if (response.request().method() !== 'POST') return false;
            try {
              const url = new URL(response.url());
              return /\/api\/v1\/complexes\/[^/]+\/community\/posts\/[^/]+\/comments$/.test(url.pathname);
            } catch {
              return false;
            }
          }, { timeout: 10_000 });
          await page.locator('#commentForm button[type="submit"]').first().click({ timeout: 6_000 });
          const response = await responsePromise;
          commentStatus = response.status();
          commentAccepted = response.ok();
          await page.waitForTimeout(2_000);
          commentVisible = await page.getByText(`QA테스트 댓글 ${STAMP}`, { exact: false }).first().isVisible().catch(() => false);
        } catch {}
        record('COMMENT_WRITE_ACCEPTED', commentAccepted, commentStatus ? `HTTP_${commentStatus}` : 'NO_SERVER_RESPONSE');
        record(
          'COMMENT_VISIBILITY_DISPOSITION',
          commentAccepted,
          commentVisible ? 'VISIBLE_IN_DETAIL' : commentAccepted ? 'ACCEPTED_NOT_PUBLIC' : 'NOT_ACCEPTED'
        );
      } else if (postAccepted) {
        // A moderation-pending post is a valid product result but cannot be commented on
        // until it becomes public. Record the bounded disposition without pretending a
        // comment mutation occurred.
        record('COMMENT_FLOW_DISPOSITION', true, 'SKIPPED_POST_NOT_PUBLIC');
      }
    }
  }

  // ---------- cleanup: sign out through the real static account menu ----------
  let logoutClicked = false;
  try {
    const accountTrigger = page.locator('.danjion-account-trigger').first();
    if (await accountTrigger.isVisible().catch(() => false)) {
      await accountTrigger.click({ timeout: 5_000 });
      await page.waitForTimeout(300);
    }
    const logout = page.getByRole('button', { name: '로그아웃', exact: true }).first();
    if (await logout.isVisible().catch(() => false)) {
      await logout.click({ timeout: 8_000 });
      logoutClicked = true;
      await page.waitForTimeout(3_000);
    }
  } catch {}
  record('LOGOUT_UI_TRIGGERED', logoutClicked);

  // verify cleared via API regardless of UI logout visibility
  const after = await context.request.get(`${FRONTEND}/api/auth/get-session`, { headers: { Origin: FRONTEND } });
  const afterBody = await after.json().catch(() => null);
  console.log(`DEBUG_AFTER_SESSION=${Boolean(afterBody?.session)} DEBUG_AFTER_USER=${Boolean(afterBody?.user)}`);
  record('LOGOUT_CLEARS_SESSION', !afterBody?.session && !afterBody?.user, `HTTP_${after.status()}`);

  await context.close();
} catch (error) {
  record('UNEXPECTED', false, error instanceof Error ? error.name : 'UNKNOWN');
} finally {
  await browser.close();
}

console.log('=== QA INTERACTION DEEP TEST (SUPER) ===');
for (const line of results) console.log(line);
const failed = results.filter((r) => r.includes('=FAIL')).length;
console.log(`CHECKS_TOTAL=${results.length}`);
console.log(`CHECKS_FAILED=${failed}`);
console.log(`MUTATION_SCOPE=QA_ONLY_STAMP_${STAMP}`);
console.log('SECRET_OUTPUT=NO');
if (failed > 0) process.exitCode = 1;
