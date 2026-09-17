import { chromium } from '@playwright/test';

const EXPECTED_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const EXPECTED_FRONTEND_HOST = 'danjion-qa.pages.dev';
const COMPLEX_SLUG = 'banglim-myeongji-roadhill';

const PERSONAS = Object.freeze([
  { name: 'QA_RESIDENT', emailEnv: 'DANJION_QA_RESIDENT_EMAIL', passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD' },
  { name: 'QA_OPERATIONAL', emailEnv: 'DANJION_QA_OPERATIONAL_EMAIL', passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD' },
  { name: 'QA_SUPER', emailEnv: 'DANJION_QA_SUPER_EMAIL', passwordEnv: 'DANJION_QA_SUPER_PASSWORD' }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_PERSONA_SESSION_LEAK_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(value, expectedHost, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_PERSONA_SESSION_LEAK_${label}_ORIGIN_INVALID`);
  }
  return url.origin;
}

function deny(status) {
  return status === 401 || status === 403;
}

async function browserStatus(page, path) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' }
    });
    return response.status;
  }, path);
}

async function isLoggedOut(context, frontendBase) {
  const response = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase }
  });
  if (response.status() !== 200) return false;
  const body = await response.json().catch(() => null);
  return !(body?.session || body?.user);
}

async function readSessionSubject(context, frontendBase, errorCode) {
  const session = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase }
  });
  if (session.status() !== 200) throw new Error(`${errorCode}_HTTP_${session.status()}`);
  const sessionBody = await session.json().catch(() => null);
  const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
  if (!subject || !sessionBody?.session) throw new Error(`${errorCode}_NOT_AUTHENTICATED`);
  return subject;
}

function report(results) {
  for (const result of results) {
    if (result.name) {
      console.log(`PERSONA=${result.name}`);
      console.log(`LOGOUT_SESSION_CLEARED=${result.logoutSessionCleared ? 'PASS' : 'FAIL'}`);
      console.log(`LOGOUT_API_GUARD=${result.logoutApiGuard ? 'PASS' : 'FAIL'}`);
    }
  }
  const chain = results.find((result) => result.switchChainClean !== undefined);
  console.log(`SWITCH_CHAIN_CLEAN=${chain?.switchChainClean ? 'PASS' : 'FAIL'}`);
  const ambient = results.find((result) => result.ambientContextClean !== undefined);
  console.log(`AMBIENT_CONTEXT_CLEAN=${ambient?.ambientContextClean ? 'PASS' : 'FAIL'}`);
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
}

exactHttpsOrigin(required('DANJION_QA_API_URL'), EXPECTED_API_HOST, 'API');
const frontendBase = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), EXPECTED_FRONTEND_HOST, 'FRONTEND');
const credentials = PERSONAS.map((persona) => ({
  ...persona,
  email: required(persona.emailEnv).toLowerCase(),
  password: required(persona.passwordEnv)
}));
if (new Set(credentials.map(({ email }) => email)).size !== PERSONAS.length) {
  throw new Error('QA_PERSONA_SESSION_LEAK_IDENTITIES_MUST_BE_DISTINCT');
}
for (const credential of credentials) {
  if (credential.password.length < 8) throw new Error(`QA_PERSONA_SESSION_LEAK_PASSWORD_INVALID:${credential.name}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const results = [];
  const baselineSubjects = new Map();

  // Phase 1: per-persona logout leak check (isolated context each)
  for (const persona of credentials) {
    const context = await browser.newContext();
    try {
      if (!(await isLoggedOut(context, frontendBase))) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_PREEXISTING_SESSION:${persona.name}`);
      }

      const signIn = await context.request.post(`${frontendBase}/api/auth/sign-in/email`, {
        headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
        data: { email: persona.email, password: persona.password }
      });
      if (signIn.status() !== 200) throw new Error(`QA_PERSONA_SESSION_LEAK_SIGNIN_HTTP_${signIn.status()}:${persona.name}`);

      const subject = await readSessionSubject(context, frontendBase, `QA_PERSONA_SESSION_LEAK_SESSION:${persona.name}`);
      baselineSubjects.set(persona.name, subject);

      const page = await context.newPage();
      await page.goto(`${frontendBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      const expectedAuthority = persona.name === 'QA_RESIDENT' ? 403 : 200;
      const authedAuthority = await browserStatus(page, '/api/v1/admin/authority');
      if (authedAuthority !== expectedAuthority) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_BASELINE_AUTHORITY:${persona.name}:EXPECTED_${expectedAuthority}_GOT_${authedAuthority}`);
      }

      const signOut = await context.request.post(`${frontendBase}/api/auth/sign-out`, {
        headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
        data: {}
      });
      if (signOut.status() < 200 || signOut.status() >= 300) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_LOGOUT_HTTP_${signOut.status()}:${persona.name}`);
      }
      if (!(await isLoggedOut(context, frontendBase))) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_SESSION_NOT_CLEARED:${persona.name}`);
      }

      const afterLogoutAuthority = await browserStatus(page, '/api/v1/admin/authority');
      if (!deny(afterLogoutAuthority)) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_AUTHORITY_ALLOWED_AFTER_LOGOUT_${afterLogoutAuthority}:${persona.name}`);
      }
      const afterLogoutProfile = await browserStatus(page, `/api/v1/me/profile?complexSlug=${COMPLEX_SLUG}`);
      if (!deny(afterLogoutProfile)) {
        throw new Error(`QA_PERSONA_SESSION_LEAK_PROFILE_ALLOWED_AFTER_LOGOUT_${afterLogoutProfile}:${persona.name}`);
      }

      results.push({ name: persona.name, logoutSessionCleared: true, logoutApiGuard: true });
    } finally {
      await context.close();
    }
  }

  // Phase 2: account switch chain (single context, sequential sign-in/sign-out)
  {
    const context = await browser.newContext();
    try {
      if (!(await isLoggedOut(context, frontendBase))) {
        throw new Error('QA_PERSONA_SESSION_LEAK_PREEXISTING_SESSION:SWITCH_CHAIN');
      }
      let previousSubject = '';
      for (const persona of credentials) {
        const signIn = await context.request.post(`${frontendBase}/api/auth/sign-in/email`, {
          headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
          data: { email: persona.email, password: persona.password }
        });
        if (signIn.status() !== 200) {
          throw new Error(`QA_PERSONA_SESSION_LEAK_SWITCH_SIGNIN_HTTP_${signIn.status()}:${persona.name}`);
        }
        const subject = await readSessionSubject(context, frontendBase, `QA_PERSONA_SESSION_LEAK_SWITCH_SESSION:${persona.name}`);
        if (previousSubject && subject === previousSubject) {
          throw new Error(`QA_PERSONA_SESSION_LEAK_SWITCH_CROSS_CONTAMINATION:${persona.name}`);
        }
        if (subject !== baselineSubjects.get(persona.name)) {
          throw new Error(`QA_PERSONA_SESSION_LEAK_SWITCH_SUBJECT_MISMATCH:${persona.name}`);
        }
        previousSubject = subject;

        const signOut = await context.request.post(`${frontendBase}/api/auth/sign-out`, {
          headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
          data: {}
        });
        if (signOut.status() < 200 || signOut.status() >= 300) {
          throw new Error(`QA_PERSONA_SESSION_LEAK_SWITCH_LOGOUT_HTTP_${signOut.status()}:${persona.name}`);
        }
        if (!(await isLoggedOut(context, frontendBase))) {
          throw new Error(`QA_PERSONA_SESSION_LEAK_SWITCH_RESIDUAL_SESSION:${persona.name}`);
        }
      }
      results.push({ switchChainClean: true });
    } finally {
      await context.close();
    }
  }

  // Phase 3: ambient fresh context must never hold a session
  {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`${frontendBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const authority = await browserStatus(page, '/api/v1/admin/authority');
      if (!deny(authority)) throw new Error(`QA_PERSONA_SESSION_LEAK_AMBIENT_AUTHORITY_${authority}`);
      const profile = await browserStatus(page, `/api/v1/me/profile?complexSlug=${COMPLEX_SLUG}`);
      if (!deny(profile)) throw new Error(`QA_PERSONA_SESSION_LEAK_AMBIENT_PROFILE_${profile}`);
      results.push({ ambientContextClean: true });
    } finally {
      await context.close();
    }
  }

  report(results);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'QA_PERSONA_SESSION_LEAK_FAILED');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
