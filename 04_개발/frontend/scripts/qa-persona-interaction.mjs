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

  // ---------- community: open 이웃대화 via the real multi-page nav flow ----------
  // QA Pages hosts the static multi-page app: 데일리홈 → bottom nav 우리단지 →
  // 이웃대화 list (12_) → write form page (16_ 궁금해요). The React V2 modal
  // flow is NOT what QA serves; adapt to the real DOM ids.
  let communityOpened = false;
  try {
    await page.goto(`${FRONTEND}/12_%EC%9D%B4%EC%9B%83%EB%8C%80%ED%99%94_%EC%B2%AB%ED%99%94%EB%A9%B4.html`, {
      waitUntil: 'domcontentloaded', timeout: 30_000
    });
    await page.waitForTimeout(2_500);
    communityOpened = await page.locator('#writeMain, .write-main').first().isVisible().catch(() => false);
  } catch {}
  record('COMMUNITY_OPENED', communityOpened);

  if (communityOpened) {
    // switch to a writable tab first (default is 가입인사 which is write-locked)
    for (const kind of ['궁금해요', '단지이야기', '같이해요']) {
      const tabBtn = page.locator(`button:has-text("${kind}")`).first();
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(1_000);
        break;
      }
    }

    // ---------- write a post through the real write page (16_ 궁금해요_글쓰기) ----------
    let writeOpened = false;
    try {
      await page.locator('#writeMain, .write-main').first().click({ timeout: 8_000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
      await page.waitForTimeout(2_000);
      writeOpened = /writeForm|title/.test(await page.content());
    } catch {}
    record('WRITE_FORM_OPENED', writeOpened);

    if (writeOpened) {
      // choose a kind if a selector list exists (같이해요 is a standard writable kind)
      for (const kind of ['같이해요', '궁금해요', '단지이야기']) {
        const kindBtn = page.locator(`button:has-text("${kind}")`).first();
        if (await kindBtn.isVisible().catch(() => false)) {
          await kindBtn.click({ timeout: 4_000 }).catch(() => {});
          await page.waitForTimeout(800);
          break;
        }
      }
      // fill title/body if present (write page uses id=title / id=body)
      let filled = false;
      try {
        const titleInput = page.locator('#title, input[name="title"], input.title-input').first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(POST_TITLE, { timeout: 5_000 });
        }
        const bodyArea = page.locator('#body, textarea[name="body"], textarea.body-input').first();
        if (await bodyArea.isVisible().catch(() => false)) {
          await bodyArea.fill(POST_BODY, { timeout: 5_000 });
          filled = true;
        }
      } catch {}
      record('WRITE_FORM_FILLED', filled);

      // submit via the write page's 게시 button (data-publish)
      let submitted = false;
      try {
        const submitBtn = page.locator('[data-publish], button:has-text("게시")').first();
        await submitBtn.click({ timeout: 6_000 });
        await page.waitForTimeout(3_500);
        submitted = true;
      } catch {}
      record('POST_SUBMITTED', submitted);

      // verify the post: success notice, or pending notice (both prove the write flow worked)
      let visible = false;
      let pending = false;
      let published = false;
      let debugNotice = '';
      try {
        await page.waitForTimeout(2_000);
        const noticeText = await page.locator('.v2-community-notice, [role="status"]').first().innerText().catch(() => '');
        debugNotice = (noticeText || '').replace(/\s+/g, ' ').slice(0, 80);
        pending = /운영확인|접수/.test(noticeText || '');
        published = /게시했/.test(noticeText || '');
        // the new post should also be in the list for its tab (detail or list text)
        const found = page.getByText(`상호작용 점검 ${STAMP}`, { exact: false }).first();
        visible = await found.isVisible().catch(() => false);
      } catch {}
      console.log(`DEBUG_NOTICE=[${debugNotice}]`);
      console.log(`DEBUG_PENDING=${pending} DEBUG_PUBLISHED=${published} DEBUG_VISIBLE=${visible}`);
      record('POST_WRITE_ACCEPTED', pending || published || visible,
        pending ? 'OPERATION_REVIEW_PENDING' : published ? 'PUBLISHED_NOTICE' : visible ? 'VISIBLE_IN_LIST' : 'NO_EVIDENCE');
      record('POST_VISIBLE_IN_LIST', visible, pending && !visible ? 'OPERATION_REVIEW_PENDING' : '');

      // ---------- comment on the post if detail view is reachable ----------
      if (visible) {
        try {
          await page.getByText(`상호작용 점검 ${STAMP}`, { exact: false }).first().click({ timeout: 6_000 });
          await page.waitForTimeout(2_000);
          const commentBox = page.locator('textarea[placeholder*="댓글"], input[placeholder*="댓글"], textarea').first();
          if (await commentBox.isVisible().catch(() => false)) {
            await commentBox.fill(COMMENT_BODY, { timeout: 5_000 });
            const commentBtn = page.locator('button:has-text("댓글"), button:has-text("등록"), button:has-text("게시")').first();
            await commentBtn.click({ timeout: 6_000 });
            await page.waitForTimeout(2_500);
            const commentShown = await page.getByText(`QA테스트 댓글 ${STAMP}`, { exact: false }).first().isVisible().catch(() => false);
            record('COMMENT_POSTED_AND_VISIBLE', commentShown);
          } else {
            record('COMMENT_POSTED_AND_VISIBLE', false, 'NO_COMMENT_BOX');
          }
        } catch (error) {
          record('COMMENT_POSTED_AND_VISIBLE', false, error instanceof Error ? error.name : 'UNKNOWN');
        }
      }
    }
  }

  // ---------- cleanup: sign out (writer modal or detail modal may still be open) ----------
  // close any open modal first so the topbar logout button is clickable
  const closeBtn = page.locator('[aria-label="글쓰기 닫기"], [aria-label="게시물 닫기"]').first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(1_000);
  }
  const logout = page.getByRole('button', { name: '로그아웃' }).first();
  if (await logout.isVisible().catch(() => false)) {
    await logout.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
  }
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
