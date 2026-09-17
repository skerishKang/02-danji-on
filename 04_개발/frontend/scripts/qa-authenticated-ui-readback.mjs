import { chromium } from '@playwright/test';

const EXPECTED_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const EXPECTED_FRONTEND_HOST = 'danjion-qa.pages.dev';
const PENDING_COPY = '주민인증 심사 대기 중';
const PENDING_HERO = '우리집 연결됨 · 주민인증 심사 대기 중';

function exactHttpsOrigin(value, expectedHost, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label}_ORIGIN_INVALID`);
  }
  return url.origin;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

const apiBase = exactHttpsOrigin(required('DANJION_QA_API_URL'), EXPECTED_API_HOST, 'QA_API');
const frontendBase = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), EXPECTED_FRONTEND_HOST, 'QA_FRONTEND');
const email = required('DANJION_QA_EMAIL');
const password = required('DANJION_QA_PASSWORD');

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const signin = await context.request.post(`${apiBase}/api/auth/sign-in/email`, {
    headers: {
      Origin: frontendBase,
      'Content-Type': 'application/json',
    },
    data: { email, password },
  });
  if (signin.status() !== 200) throw new Error(`SIGNIN_HTTP_${signin.status()}`);

  const session = await context.request.get(`${apiBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase },
  });
  if (session.status() !== 200) throw new Error(`SESSION_HTTP_${session.status()}`);
  const sessionJson = await session.json().catch(() => null);
  if (!sessionJson || !sessionJson.session || !sessionJson.user) throw new Error('SESSION_NOT_AUTHENTICATED');

  const page = await context.newPage();

  await page.goto(new URL('19_내정보_메인.html', `${frontendBase}/`).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForFunction(
    (pending) => document.body && document.body.innerText.includes(pending),
    PENDING_COPY,
    { timeout: 20_000 },
  );
  const page19Pending = await page.evaluate((pending) => document.body.innerText.includes(pending), PENDING_COPY);
  if (!page19Pending) throw new Error('PAGE_19_PENDING_COPY_MISSING');

  await page.goto(new URL('26_우리집연결.html', `${frontendBase}/`).href, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForFunction(() => {
    const panel = document.getElementById('household-home-panel');
    const hero = document.getElementById('household-home-complex');
    return panel && !panel.hidden && hero && hero.textContent && hero.textContent !== '우리집 연결 완료';
  }, null, { timeout: 20_000 });

  const page26 = await page.evaluate(() => ({
    hero: document.getElementById('household-home-complex')?.textContent || '',
    role: document.getElementById('household-my-role')?.textContent || '',
    panelVisible: Boolean(document.getElementById('household-home-panel') && !document.getElementById('household-home-panel').hidden),
  }));

  if (!page26.panelVisible) throw new Error('PAGE_26_SERVER_PANEL_NOT_VISIBLE');
  if (!page26.hero.includes(PENDING_HERO)) throw new Error('PAGE_26_PENDING_HERO_MISMATCH');
  if (!page26.role.includes(PENDING_COPY)) throw new Error('PAGE_26_PENDING_MEMBER_COPY_MISMATCH');
  if (page26.hero.trim().endsWith('우리집 연결 완료')) throw new Error('PAGE_26_BARE_COMPLETION_VISIBLE');

  console.log('AUTHENTICATED_BROWSER_SESSION=PASS');
  console.log('PAGE_19_PENDING_COPY=PASS');
  console.log('PAGE_26_PENDING_HERO=PASS');
  console.log('PAGE_26_PENDING_MEMBER_COPY=PASS');
  console.log('BARE_COMPLETION_COPY_VISIBLE=NO');
  console.log('QA_AUTH_SESSION_MUTATION=EPHEMERAL_ONLY');
  console.log('QA_FIXTURE_MUTATION=0');
  console.log('PRODUCTION_MUTATION=0');
  console.log('SECRET_OUTPUT=NO');

  await context.close();
} catch (error) {
  const code = error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/g, '_').slice(0, 160) : 'UNKNOWN_FAILURE';
  console.error(`QA_AUTHENTICATED_UI_READBACK_FAILED=${code}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
