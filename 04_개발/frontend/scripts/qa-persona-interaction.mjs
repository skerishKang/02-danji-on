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

  // ---------- community: open 이웃대화 via the real nav flow ----------
  // 1) topbar nav "우리단지" opens V2ComplexHub
  // 2) hub card "이웃대화 들어가기" opens V2CommunityView
  let communityOpened = false;
  try {
    await page.locator('[data-v2-nav-key="community"], button:has-text("우리단지")').first().click({ timeout: 8_000 });
    await page.waitForTimeout(2_000);
    await page.getByRole('button', { name: /이웃대화 들어가기/ }).first().click({ timeout: 8_000 });
    await page.waitForTimeout(2_500);
    const content = await page.content();
    communityOpened = /이웃대화|궁금해요|같이해요|가입인사|단지이야기/.test(content);
  } catch {}
  record('COMMUNITY_OPENED', communityOpened);

  if (communityOpened) {
    // switch to a writable tab first (default tab is 가입인사 which is write-locked)
    // choose 궁금해요 or 단지이야기 or 같이해요 — first visible one
    for (const kind of ['궁금해요', '단지이야기', '같이해요']) {
      const tabBtn = page.locator(`button:has-text("${kind}")`).first();
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click({ timeout: 4_000 }).catch(() => {});
        await page.waitForTimeout(1_000);
        break;
      }
    }

    // ---------- write a post through the UI ----------
    let writeOpened = false;
    try {
      const writeBtn = page.locator('.v2-community-write-main, [aria-label="현재 카테고리 글쓰기"], button:has-text("글쓰기")').first();
      await writeBtn.click({ timeout: 8_000 });
      await page.waitForTimeout(1_500);
      writeOpened = true;
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
      // fill title/body if present (writer form uses name=title / name=body)
      let filled = false;
      try {
        const titleInput = page.locator('input[name="title"], input[placeholder*="제목"], input[placeholder*="무엇"]').first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(POST_TITLE, { timeout: 5_000 });
        }
        const bodyArea = page.locator('textarea[name="body"], textarea').first();
        if (await bodyArea.isVisible().catch(() => false)) {
          await bodyArea.fill(POST_BODY, { timeout: 5_000 });
          filled = true;
        }
      } catch {}
      record('WRITE_FORM_FILLED', filled);

      // submit (게시하기 primary button)
      let submitted = false;
      try {
        // session may have expired between login and submit — refresh via API if needed
        const s = await sessionShape(context);
        if (!s.hasSession) {
          console.log('DEBUG_SESSION_EXPIRED_BEFORE_SUBMIT=true — refreshing via API sign-in');
          await context.request.post(`${FRONTEND}/api/auth/sign-in/email`, {
            headers: { Origin: FRONTEND, 'Content-Type': 'application/json' },
            data: { email, password }
          });
          await page.waitForTimeout(1_000);
        }
        const submitBtn = page.locator('button:has-text("게시하기"), button[type="submit"]').first();
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
