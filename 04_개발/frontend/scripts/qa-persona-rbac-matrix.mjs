import { chromium } from '@playwright/test';

const EXPECTED_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const EXPECTED_FRONTEND_HOST = 'danjion-qa.pages.dev';
const COMPLEX_SLUG = 'banglim-myeongji-roadhill';
const OPERATIONAL_SCOPES = Object.freeze([
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident_news.review',
  'safety.report.review'
]);

const PERSONAS = Object.freeze([
  { name: 'QA_RESIDENT', emailEnv: 'DANJION_QA_RESIDENT_EMAIL', passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD' },
  { name: 'QA_OPERATIONAL', emailEnv: 'DANJION_QA_OPERATIONAL_EMAIL', passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD' },
  { name: 'QA_SUPER', emailEnv: 'DANJION_QA_SUPER_EMAIL', passwordEnv: 'DANJION_QA_SUPER_PASSWORD' }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_PERSONA_MATRIX_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(value, expectedHost, label) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_PERSONA_MATRIX_${label}_ORIGIN_INVALID`);
  }
  return url.origin;
}

function sameSet(actual, expected) {
  const a = [...new Set(actual.map((value) => String(value)))].sort();
  const e = [...new Set(expected.map((value) => String(value)))].sort();
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

async function browserJson(page, path, headers = {}) {
  return page.evaluate(async ({ path, headers }) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...headers }
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }, { path, headers });
}

async function browserStatus(page, path, headers = {}) {
  return page.evaluate(async ({ path, headers }) => {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...headers }
    });
    return response.status;
  }, { path, headers });
}

async function assertLoggedOut(context, frontendBase) {
  const response = await context.request.get(`${frontendBase}/api/auth/get-session`, {
    headers: { Origin: frontendBase }
  });
  if (response.status() !== 200) throw new Error(`QA_PERSONA_MATRIX_LOGOUT_SESSION_HTTP_${response.status()}`);
  const body = await response.json().catch(() => null);
  if (body?.session || body?.user) throw new Error('QA_PERSONA_MATRIX_SESSION_LEAK_AFTER_LOGOUT');
}

function report(result) {
  console.log(`PERSONA=${result.name}`);
  console.log('AUTH=PASS');
  console.log(`RESIDENT_VERIFIED=${result.residentVerified ? 'true' : 'false'}`);
  console.log(`AUTHORITY_LEVEL=${result.authorityLevel}`);
  console.log(`WILDCARD=${result.wildcard ? 'true' : 'false'}`);
  console.log(`BOUNDED_SCOPE_COUNT=${result.boundedScopeCount}`);
  console.log(`PRIVILEGED_ACCESS=${result.privilegedAccess}`);
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
  throw new Error('QA_PERSONA_MATRIX_IDENTITIES_MUST_BE_DISTINCT');
}
for (const credential of credentials) {
  if (credential.password.length < 8) throw new Error(`QA_PERSONA_MATRIX_PASSWORD_INVALID:${credential.name}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const observedSubjects = new Set();
  const results = [];

  for (const persona of credentials) {
    const context = await browser.newContext();
    try {
      await assertLoggedOut(context, frontendBase);

      const signIn = await context.request.post(`${frontendBase}/api/auth/sign-in/email`, {
        headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
        data: { email: persona.email, password: persona.password }
      });
      if (signIn.status() !== 200) throw new Error(`QA_PERSONA_MATRIX_SIGNIN_HTTP_${signIn.status()}:${persona.name}`);

      const session = await context.request.get(`${frontendBase}/api/auth/get-session`, {
        headers: { Origin: frontendBase }
      });
      if (session.status() !== 200) throw new Error(`QA_PERSONA_MATRIX_SESSION_HTTP_${session.status()}:${persona.name}`);
      const sessionBody = await session.json().catch(() => null);
      const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
      if (!subject || !sessionBody?.session) throw new Error(`QA_PERSONA_MATRIX_SESSION_NOT_AUTHENTICATED:${persona.name}`);
      if (observedSubjects.has(subject)) throw new Error('QA_PERSONA_MATRIX_SHARED_ACTOR_DETECTED');
      observedSubjects.add(subject);

      const page = await context.newPage();
      await page.goto(`${frontendBase}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      if (persona.name === 'QA_RESIDENT') {
        const profile = await browserJson(page, `/api/v1/me/profile?complexSlug=${COMPLEX_SLUG}`);
        if (profile.status !== 200 || profile.body?.data?.residentLabel !== 'verified_resident') {
          throw new Error('QA_PERSONA_MATRIX_RESIDENT_SURFACE_FAILED');
        }
        const authority = await browserStatus(page, '/api/v1/admin/authority');
        if (authority !== 403) throw new Error(`QA_PERSONA_MATRIX_RESIDENT_AUTHORITY_EXPECTED_403_GOT_${authority}`);
        const privileged = await browserStatus(page, '/api/v1/admin/audit-events?limit=1');
        if (privileged !== 403) throw new Error(`QA_PERSONA_MATRIX_RESIDENT_PRIVILEGED_EXPECTED_403_GOT_${privileged}`);
        const spoofed = await browserStatus(page, '/api/v1/admin/audit-events?limit=1', {
          'x-danjion-role': 'admin',
          'x-danjion-verified': 'true',
          'x-danjion-complex': COMPLEX_SLUG
        });
        if (spoofed !== 403) throw new Error(`QA_PERSONA_MATRIX_CLIENT_ELEVATION_DETECTED_${spoofed}`);
        results.push({
          name: persona.name,
          residentVerified: true,
          authorityLevel: 'none',
          wildcard: false,
          boundedScopeCount: 0,
          privilegedAccess: 'DENIED'
        });
      } else if (persona.name === 'QA_OPERATIONAL') {
        const authority = await browserJson(page, '/api/v1/admin/authority');
        const data = authority.body?.data;
        if (authority.status !== 200 || data?.level !== 'operator' || data?.wildcard !== false || !Array.isArray(data?.scopes)) {
          throw new Error('QA_PERSONA_MATRIX_OPERATIONAL_AUTHORITY_FAILED');
        }
        if (!sameSet(data.scopes, OPERATIONAL_SCOPES)) throw new Error('QA_PERSONA_MATRIX_OPERATIONAL_SCOPE_MISMATCH');
        const operational = await browserStatus(page, `/api/v1/admin/complexes/${COMPLEX_SLUG}/posts?status=all`);
        if (operational !== 200) throw new Error(`QA_PERSONA_MATRIX_OPERATIONAL_SURFACE_HTTP_${operational}`);
        const privileged = await browserStatus(page, '/api/v1/admin/audit-events?limit=1');
        if (privileged !== 403) throw new Error(`QA_PERSONA_MATRIX_OPERATIONAL_PRIVILEGED_EXPECTED_403_GOT_${privileged}`);
        results.push({
          name: persona.name,
          residentVerified: false,
          authorityLevel: 'operator',
          wildcard: false,
          boundedScopeCount: OPERATIONAL_SCOPES.length,
          privilegedAccess: 'DENIED'
        });
      } else {
        const authority = await browserJson(page, '/api/v1/admin/authority');
        const data = authority.body?.data;
        if (authority.status !== 200 || data?.level !== 'admin' || data?.wildcard !== true || !Array.isArray(data?.scopes)) {
          throw new Error('QA_PERSONA_MATRIX_SUPER_AUTHORITY_FAILED');
        }
        if (!sameSet(data.scopes, ['*'])) throw new Error('QA_PERSONA_MATRIX_SUPER_SCOPE_MISMATCH');
        const privileged = await browserStatus(page, '/api/v1/admin/audit-events?limit=1');
        if (privileged !== 200) throw new Error(`QA_PERSONA_MATRIX_SUPER_PRIVILEGED_HTTP_${privileged}`);
        results.push({
          name: persona.name,
          residentVerified: false,
          authorityLevel: 'admin',
          wildcard: true,
          boundedScopeCount: 0,
          privilegedAccess: 'PASS'
        });
      }

      const signOut = await context.request.post(`${frontendBase}/api/auth/sign-out`, {
        headers: { Origin: frontendBase, 'Content-Type': 'application/json' },
        data: {}
      });
      if (signOut.status() < 200 || signOut.status() >= 300) {
        throw new Error(`QA_PERSONA_MATRIX_SIGNOUT_HTTP_${signOut.status()}:${persona.name}`);
      }
      await assertLoggedOut(context, frontendBase);
    } finally {
      await context.close();
    }
  }

  if (observedSubjects.size !== PERSONAS.length) throw new Error('QA_PERSONA_MATRIX_DISTINCT_ACTOR_COUNT_MISMATCH');
  for (const result of results) report(result);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'QA_PERSONA_MATRIX_FAILED');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
