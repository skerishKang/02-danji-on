import { fileURLToPath } from 'node:url';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
const PROBE_COMPLEX = 'banglim-myeongji-roadhill';

const PERSONAS = Object.freeze([
  { name: 'QA_SUPER', email: 'skerish_super_test@naver.com', passwordEnv: 'DANJION_QA_SUPER_PASSWORD', exemption: 'false', authority: 'admin', residentGate: 'forbidden' },
  { name: 'QA_OPERATOR', email: 'skerish_manage_test@naver.com', passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD', exemption: 'operator', authority: 'operator', residentGate: 'allowed' },
  { name: 'QA_RESIDENT', email: 'skerish_people_test@naver.com', passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD', exemption: 'false', authority: 'forbidden', residentGate: 'allowed' },
  { name: 'QA_TEMP_RESIDENT', email: 'skerish_temp_resident_test@naver.com', passwordEnv: 'DANJION_QA_TEMP_RESIDENT_PASSWORD', exemption: 'temporary', authority: 'forbidden', residentGate: 'allowed' }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_TEMP_ACCEPTANCE_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_TEMP_ACCEPTANCE_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return values.map((value) => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
}

function authHeaders(origin, cookie, bearer) {
  return {
    accept: 'application/json',
    origin,
    ...(cookie ? { cookie } : {}),
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
  };
}

async function readJson(response) {
  return response.json().catch(() => null);
}

function errorCode(body) {
  return String(body?.error?.code || 'NONE');
}

function assert(condition, token) {
  if (!condition) throw new Error(`QA_TEMP_ACCEPTANCE_${token}`);
}

async function signIn(frontendOrigin, apiOrigin, account) {
  const password = required(account.passwordEnv);
  assert(password.length >= 8, `PASSWORD_INVALID:${account.name}`);
  const signIn = await fetch(new URL('/api/auth/sign-in/email', frontendOrigin), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
    body: JSON.stringify({ email: account.email, password }),
    redirect: 'manual'
  });
  assert(signIn.status === 200, `SIGNIN_HTTP_${account.name}_${signIn.status}`);
  const cookie = cookieHeader(signIn);
  const sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
  assert(cookie || sessionBearer, `SESSION_CREDENTIAL_MISSING:${account.name}`);

  const session = await fetch(new URL('/api/auth/get-session', frontendOrigin), {
    headers: authHeaders(frontendOrigin, cookie, sessionBearer),
    redirect: 'manual'
  });
  assert(session.ok, `SESSION_HTTP_${account.name}_${session.status}`);
  let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
  if (!jwt) {
    const token = await fetch(new URL('/api/auth/token', frontendOrigin), {
      headers: authHeaders(frontendOrigin, cookie, sessionBearer),
      redirect: 'manual'
    });
    assert(token.ok, `TOKEN_HTTP_${account.name}_${token.status}`);
    const tokenBody = await readJson(token);
    jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
  }
  assert(jwt, `SERVICE_JWT_MISSING:${account.name}`);

  const me = await fetch(new URL('/api/v1/me', apiOrigin), {
    headers: { accept: 'application/json', origin: frontendOrigin, authorization: `Bearer ${jwt}` },
    redirect: 'manual'
  });
  assert(me.ok, `AUTH_BRIDGE_HTTP_${account.name}_${me.status}`);
  return { cookie, sessionBearer, jwt };
}

async function apiGet(apiOrigin, frontendOrigin, jwt, path) {
  const response = await fetch(new URL(path, apiOrigin), {
    headers: { accept: 'application/json', origin: frontendOrigin, authorization: `Bearer ${jwt}` },
    redirect: 'manual'
  });
  return { response, body: await readJson(response) };
}

function checkExemption(account, status, body) {
  assert(status === 200, `EXEMPTION_HTTP_${account.name}_${status}`);
  const data = body?.data;
  assert(data && typeof data.exempt === 'boolean', `EXEMPTION_SHAPE_${account.name}`);
  assert(!Object.prototype.hasOwnProperty.call(data, 'householdId'), `EXEMPTION_HOUSEHOLD_LEAK_${account.name}`);
  assert(!Object.prototype.hasOwnProperty.call(data, 'membershipId'), `EXEMPTION_MEMBERSHIP_LEAK_${account.name}`);
  if (account.exemption === 'temporary') {
    assert(data.exempt === true && data.temporary === true, 'TEMPORARY_ADMISSION_NOT_GRANTED');
    console.log('TEMP_EXEMPT=true');
    console.log('TEMPORARY=true');
    console.log('TEMP_HOUSEHOLD_ID=null');
    console.log('TEMP_MEMBERSHIP_ID=null');
  } else if (account.exemption === 'operator') {
    assert(data.exempt === true && data.temporary !== true, 'OPERATOR_TEMPORARY_LABEL_PRESENT');
  } else {
    assert(data.exempt === false && data.temporary !== true, `${account.name}_EXEMPTION_REGRESSION`);
  }
}

function checkAuthority(account, status, body) {
  if (account.authority === 'forbidden') {
    assert(status === 401 || status === 403, `AUTHORITY_NOT_FORBIDDEN_${account.name}_${status}`);
    return;
  }
  assert(status === 200, `AUTHORITY_HTTP_${account.name}_${status}`);
  assert(body?.data?.level === account.authority, `AUTHORITY_LEVEL_${account.name}`);
  if (account.name === 'QA_SUPER') assert(body.data.temporary !== true, 'SUPER_TEMPORARY_LABEL_PRESENT');
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_TEMP_ACCEPTANCE_APP_ENV_MUST_BE_QA');
  if (process.env.DATABASE_URL || process.env.DANJION_PRODUCTION_DB_URL) throw new Error('QA_TEMP_ACCEPTANCE_PRODUCTION_DATABASE_FORBIDDEN');
  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);
  console.log('QA_TEMP_ACCEPTANCE_TARGET=QA_ONLY');
  console.log(`PERSONA_COUNT=${PERSONAS.length}`);

  for (const account of PERSONAS) {
    const session = await signIn(frontendOrigin, apiOrigin, account);
    try {
      const exemption = await apiGet(apiOrigin, frontendOrigin, session.jwt, '/api/v1/me/resident-verification-exemption');
      checkExemption(account, exemption.response.status, exemption.body);

      const authority = await apiGet(apiOrigin, frontendOrigin, session.jwt, '/api/v1/admin/authority');
      checkAuthority(account, authority.response.status, authority.body);

      const protectedRoute = await apiGet(
        apiOrigin,
        frontendOrigin,
        session.jwt,
        `/api/v1/complexes/${PROBE_COMPLEX}/resident-news`
      );
      const protectedCode = errorCode(protectedRoute.body);
      if (account.residentGate === 'forbidden') {
        assert(protectedRoute.response.status === 403 && protectedCode === 'RESIDENT_VERIFICATION_REQUIRED', `PROTECTED_RESIDENT_GATE_${account.name}`);
      } else {
        assert(protectedCode !== 'RESIDENT_VERIFICATION_REQUIRED', `PROTECTED_RESIDENT_GATE_${account.name}`);
      }
      console.log(`PERSONA=${account.name} SIGNIN=200 EXEMPTION=PASS AUTHORITY=PASS PROTECTED_GATE=PASS`);
    } finally {
      await fetch(new URL('/api/auth/sign-out', frontendOrigin), {
        method: 'POST',
        headers: { ...authHeaders(frontendOrigin, session.cookie, session.sessionBearer), 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual'
      }).catch(() => null);
    }
  }
  console.log('QA_TEMP_RESIDENT_ACCEPTANCE=PASS');
  console.log('HOUSEHOLD_MUTATION=NO');
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'QA_TEMP_ACCEPTANCE_FAILED');
    process.exit(1);
  });
}
