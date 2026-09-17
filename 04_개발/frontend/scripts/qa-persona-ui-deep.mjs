// UI-level deep persona test (QA only). For each of the three QA personas:
// drive the real login flow (header 로그인 → modal → 이메일로 로그인 → form),
// verify session + authority surface via UI headers and API, then sign out
// and verify the session is gone. Values are never printed.
import { chromium } from '@playwright/test';

const EXPECTED_FRONTEND_HOST = 'danjion-qa.pages.dev';

const PERSONAS = Object.freeze([
  { name: 'QA_RESIDENT', emailEnv: 'DANJION_QA_RESIDENT_EMAIL', passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD', expectLevel: 'none' },
  { name: 'QA_OPERATIONAL', emailEnv: 'DANJION_QA_OPERATIONAL_EMAIL', passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD', expectLevel: 'operator' },
  { name: 'QA_SUPER', emailEnv: 'DANJION_QA_SUPER_EMAIL', passwordEnv: 'DANJION_QA_SUPER_PASSWORD', expectLevel: 'admin' }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_UI_DEEP_MISSING_INPUT:${name}`);
  return value;
}

const frontendBase = (() => {
  const url = new URL(required('DANJION_QA_FRONTEND_URL'));
  if (url.protocol !== 'https:' || url.hostname !== EXPECTED_FRONTEND_HOST || url.pathname !== '/') {
    throw new Error('QA_UI_DEEP_FRONTEND_ORIGIN_INVALID');
  }
  return url.origin;
})();

const results = [];

function record(label, pass, detail = '') {
  results.push(`${label}=${pass ? 'PASS' : 'FAIL'}${detail ? ':' + detail : ''}`);
}

async function apiStatus(page, path) {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, level: body?.data?.level ?? null };
  }, path);
}

async function sessionShape(context) {
  const response = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase }
  });
  const body = await response.json().catch(() => null);
  return { status: response.status(), hasSession: Boolean(body?.session), hasUser: Boolean(body?.user) };
}

const browser = await chromium.launch({ headless: true });
try {
  for (const persona of PERSONAS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${frontendBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2_000);

      // header shows logged-out state first
      const loginVisible = await page.getByRole('button', { name: '로그인', exact: true }).first().isVisible().catch(() => false);
      record(`${persona.name}_PRELOGIN_HEADER`, loginVisible);

      // open login modal, choose email path
      await page.getByRole('button', { name: '로그인', exact: true }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1_200);
      await page.getByRole('button', { name: /이메일로 로그인/ }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1_200);

      // fill the email/password form
      await page.locator('input[type="email"]').first().fill(required(persona.emailEnv), { timeout: 10_000 });
      await page.locator('input[type="password"]').first().fill(required(persona.passwordEnv), { timeout: 10_000 });
      await page.locator('button:has-text("로그인")').last().click({ timeout: 10_000 });
      await page.waitForTimeout(4_000);

      // session must exist now
      const session = await sessionShape(context);
      record(`${persona.name}_UI_LOGIN_SESSION`, session.hasSession && session.hasUser, `HTTP_${session.status}`);

      // header must show the logged-in state (내정보/로그아웃 present)
      const logoutVisible = await page.getByRole('button', { name: '로그아웃' }).first().isVisible().catch(() => false);
      const myinfoVisible = await page.getByRole('button', { name: '내정보' }).first().isVisible().catch(() => false);
      record(`${persona.name}_UI_LOGGED_IN_HEADER`, logoutVisible || myinfoVisible, logoutVisible ? 'logout-btn' : myinfoVisible ? 'myinfo-btn' : 'none');

      // authority API must match expected level
      const authority = await apiStatus(page, '/api/v1/admin/authority');
      if (persona.expectLevel === 'none') {
        record(`${persona.name}_AUTHORITY_DENIED`, authority.status === 403 || authority.status === 401, `HTTP_${authority.status}`);
      } else {
        record(`${persona.name}_AUTHORITY_LEVEL`, authority.status === 200 && authority.level === persona.expectLevel,
          `HTTP_${authority.status}_LEVEL_${authority.level || 'none'}`);
      }

      // privileged surface expectations
      const privileged = await apiStatus(page, '/api/v1/admin/audit-events?limit=1');
      if (persona.expectLevel === 'admin') {
        record(`${persona.name}_PRIVILEGED_ALLOWED`, privileged.status === 200, `HTTP_${privileged.status}`);
      } else {
        record(`${persona.name}_PRIVILEGED_DENIED`, privileged.status === 403, `HTTP_${privileged.status}`);
      }

      // UI logout button must work
      if (logoutVisible) {
        await page.getByRole('button', { name: '로그아웃' }).first().click({ timeout: 10_000 });
        await page.waitForTimeout(3_000);
        const after = await sessionShape(context);
        record(`${persona.name}_UI_LOGOUT_CLEARS`, !after.hasSession && !after.hasUser, `HTTP_${after.status}`);
      } else {
        // fall back to API sign-out, still verify cleared
        await context.request.post(`${frontendBase}/api/auth/sign-out`, {
          headers: { Origin: frontendBase, 'Content-Type': 'application/json' }, data: {}
        });
        const after = await sessionShape(context);
        record(`${persona.name}_API_LOGOUT_CLEARS`, !after.hasSession && !after.hasUser, `HTTP_${after.status}`);
      }
    } catch (error) {
      record(`${persona.name}_UNEXPECTED`, false, error instanceof Error ? error.name : 'UNKNOWN');
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log('=== QA PERSONA UI DEEP TEST ===');
for (const line of results) console.log(line);
const failed = results.filter((r) => r.includes('=FAIL')).length;
console.log(`CHECKS_TOTAL=${results.length}`);
console.log(`CHECKS_FAILED=${failed}`);
console.log('PRODUCTION_TARGET=NO');
console.log('SECRET_OUTPUT=NO');
if (failed > 0) process.exitCode = 1;
