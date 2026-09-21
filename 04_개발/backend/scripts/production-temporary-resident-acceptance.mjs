import { fileURLToPath } from 'node:url';

const API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
const FRONTEND_HOST = 'danjion.pages.dev';
const COMPLEX = 'banglim-myeongji-roadhill';
const PERSONAS = Object.freeze([
  { name: 'PROD_SUPER', emailEnv: 'DANJION_PRODUCTION_SUPER_EMAIL', passwordEnv: 'DANJION_PRODUCTION_SUPER_PASSWORD', exemption: 'false', admin: true, residentGate: 'forbidden' },
  { name: 'PROD_OPERATOR', emailEnv: 'DANJION_PRODUCTION_OPERATOR_EMAIL', passwordEnv: 'DANJION_PRODUCTION_OPERATOR_PASSWORD', exemption: 'operator', admin: false, residentGate: 'allowed' },
  { name: 'PROD_RESIDENT', emailEnv: 'DANJION_PRODUCTION_RESIDENT_EMAIL', passwordEnv: 'DANJION_PRODUCTION_RESIDENT_PASSWORD', exemption: 'false', admin: false, residentGate: 'allowed' },
  { name: 'PROD_TEMP_RESIDENT', emailEnv: 'DANJION_PRODUCTION_TEMP_RESIDENT_EMAIL', passwordEnv: 'DANJION_PRODUCTION_TEMP_RESIDENT_PASSWORD', exemption: 'temporary', admin: false, residentGate: 'allowed' }
]);

const required = name => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PRODUCTION_TEMP_ACCEPTANCE_MISSING_INPUT:${name}`);
  return value;
};
const assert = (condition, token) => { if (!condition) throw new Error(`PRODUCTION_TEMP_ACCEPTANCE_${token}`); };
const origin = (raw, name, host) => {
  const url = new URL(raw);
  assert(url.protocol === 'https:' && url.hostname === host && url.pathname === '/' && !url.search && !url.hash, `UNSAFE_TARGET:${name}`);
  return url.origin;
};
const cookies = response => (typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [])
  .map(value => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
const headers = (originValue, cookie, bearer) => ({ accept: 'application/json', origin: originValue, ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) });
const json = response => response.json().catch(() => null);

async function signIn(frontend, api, persona) {
  const email = required(persona.emailEnv);
  const password = required(persona.passwordEnv);
  assert(password.length >= 8, `PASSWORD_INVALID:${persona.name}`);
  const response = await fetch(new URL('/api/auth/sign-in/email', frontend), {
    method: 'POST', headers: { ...headers(frontend, '', ''), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }), redirect: 'manual'
  });
  assert(response.status === 200, `SIGNIN_HTTP_${persona.name}_${response.status}`);
  const cookie = cookies(response);
  const sessionBearer = response.headers.get('set-auth-token')?.trim() || '';
  assert(cookie || sessionBearer, `SESSION_MISSING:${persona.name}`);
  const session = await fetch(new URL('/api/auth/get-session', frontend), { headers: headers(frontend, cookie, sessionBearer), redirect: 'manual' });
  assert(session.ok, `SESSION_HTTP_${persona.name}_${session.status}`);
  let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
  if (!jwt) {
    const token = await fetch(new URL('/api/auth/token', frontend), { headers: headers(frontend, cookie, sessionBearer), redirect: 'manual' });
    assert(token.ok, `TOKEN_HTTP_${persona.name}_${token.status}`);
    jwt = String((await json(token))?.token || '').trim();
  }
  assert(jwt, `JWT_MISSING:${persona.name}`);
  const me = await fetch(new URL('/api/v1/me', api), { headers: headers(frontend, '', jwt), redirect: 'manual' });
  assert(me.ok, `AUTH_BRIDGE_HTTP_${persona.name}_${me.status}`);
  return { cookie, sessionBearer, jwt };
}

async function get(api, frontend, jwt, path) {
  const response = await fetch(new URL(path, api), { headers: headers(frontend, '', jwt), redirect: 'manual' });
  return { status: response.status, body: await json(response) };
}

function checkExemption(persona, result) {
  assert(result.status === 200 && typeof result.body?.data?.exempt === 'boolean', `EXEMPTION_SHAPE_${persona.name}`);
  const data = result.body.data;
  assert(!('householdId' in data) && !('membershipId' in data), `RESIDENT_ID_LEAK_${persona.name}`);
  if (persona.exemption === 'temporary') assert(data.exempt === true && data.temporary === true, 'TEMPORARY_ADMISSION_NOT_GRANTED');
  else if (persona.exemption === 'operator') assert(data.exempt === true && data.temporary !== true, 'OPERATOR_TEMPORARY_LABEL_PRESENT');
  else assert(data.exempt === false && data.temporary !== true, `EXEMPTION_REGRESSION_${persona.name}`);
}

async function main() {
  assert(required('APP_ENV') === 'production', 'APP_ENV_MUST_BE_PRODUCTION');
  assert(!process.env.DATABASE_URL && !process.env.DANJION_PRODUCTION_DB_URL, 'DATABASE_AUTHORITY_FORBIDDEN');
  const api = origin(required('DANJION_PRODUCTION_API_URL'), 'API', API_HOST);
  const frontend = origin(required('DANJION_PRODUCTION_FRONTEND_URL'), 'FRONTEND', FRONTEND_HOST);
  console.log('PRODUCTION_TEMP_ACCEPTANCE_TARGET=PRODUCTION_ONLY');
  console.log(`PERSONA_COUNT=${PERSONAS.length}`);
  for (const persona of PERSONAS) {
    const session = await signIn(frontend, api, persona);
    try {
      checkExemption(persona, await get(api, frontend, session.jwt, '/api/v1/me/resident-verification-exemption'));
      const authority = await get(api, frontend, session.jwt, '/api/v1/admin/authority');
      if (persona.admin) assert(authority.status === 200 && authority.body?.data?.level === 'admin' && authority.body.data.temporary !== true, 'SUPER_AUTHORITY_REGRESSION');
      else assert(authority.status === 401 || authority.status === 403, `AUTHORITY_NOT_FORBIDDEN_${persona.name}`);
      const protectedRoute = await get(api, frontend, session.jwt, `/api/v1/complexes/${COMPLEX}/resident-news`);
      const code = String(protectedRoute.body?.error?.code || 'NONE');
      if (persona.residentGate === 'forbidden') assert(protectedRoute.status === 403 && code === 'RESIDENT_VERIFICATION_REQUIRED', 'SUPER_RESIDENT_GATE_REGRESSION');
      else assert(code !== 'RESIDENT_VERIFICATION_REQUIRED', `RESIDENT_GATE_${persona.name}`);
      console.log(`PERSONA=${persona.name} SIGNIN=200 EXEMPTION=PASS AUTHORITY=PASS PROTECTED_GATE=PASS`);
    } finally {
      await fetch(new URL('/api/auth/sign-out', frontend), { method: 'POST', headers: { ...headers(frontend, session.cookie, session.sessionBearer), 'content-type': 'application/json' }, body: '{}', redirect: 'manual' }).catch(() => null);
    }
  }
  console.log('PRODUCTION_TEMP_RESIDENT_ACCEPTANCE=PASS');
  console.log('HOUSEHOLD_MUTATION=NO');
  console.log('ACCOUNT_PROVISIONING=NO');
  console.log('SECRET_OUTPUT=NO');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => { console.error(error.message); process.exit(1); });
