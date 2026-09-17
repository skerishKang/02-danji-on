import { createHouseholdClaimBridge } from '../../../frontend/assets/household-claim-bridge.js';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
const COMPLEX_SLUG = 'qa-synthetic-complex';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_DIAGNOSTIC_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_DIAGNOSTIC_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return values.map((value) => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
}

function sessionHeaders(origin, cookie, sessionBearer) {
  return {
    accept: 'application/json',
    origin,
    ...(cookie ? { cookie } : {}),
    ...(sessionBearer ? { authorization: `Bearer ${sessionBearer}` } : {})
  };
}

async function expectOk(label, response) {
  if (!response.ok) throw new Error(`QA_DIAGNOSTIC_${label}_HTTP_${response.status}`);
}

function errorCode(result) {
  return String(result?.error?.code || result?.code || 'NONE');
}

function safeSnapshot(result) {
  return {
    status: Number(result?.status || 0),
    ok: result?.ok === true,
    errorCode: errorCode(result),
    membershipStatus: String(result?.data?.myMembership?.status || 'NONE'),
    residentVerified: result?.data?.myMembership?.residentVerified === true
  };
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_DIAGNOSTIC_APP_ENV_MUST_BE_QA');
  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);
  const email = required('DANJION_QA_EMAIL');
  const password = required('DANJION_QA_PASSWORD');

  let cookie = '';
  let sessionBearer = '';

  try {
    const signIn = await fetch(new URL('/api/auth/sign-in/email', apiOrigin), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
      body: JSON.stringify({ email, password }),
      redirect: 'manual'
    });
    await expectOk('SIGNIN', signIn);
    cookie = cookieHeader(signIn);
    sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
    if (!cookie && !sessionBearer) throw new Error('QA_DIAGNOSTIC_SESSION_CREDENTIAL_MISSING');

    const session = await fetch(new URL('/api/auth/get-session', apiOrigin), {
      headers: sessionHeaders(frontendOrigin, cookie, sessionBearer),
      redirect: 'manual'
    });
    await expectOk('SESSION', session);

    let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const token = await fetch(new URL('/api/auth/token', apiOrigin), {
        headers: sessionHeaders(frontendOrigin, cookie, sessionBearer),
        redirect: 'manual'
      });
      await expectOk('TOKEN', token);
      const tokenBody = await token.json().catch(() => null);
      jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
    }
    if (!jwt) throw new Error('QA_DIAGNOSTIC_SERVICE_JWT_MISSING');

    const me = await fetch(new URL('/api/v1/me', apiOrigin), {
      headers: { accept: 'application/json', authorization: `Bearer ${jwt}`, origin: frontendOrigin },
      redirect: 'manual'
    });
    await expectOk('AUTH_BRIDGE', me);

    const Session = {
      joinUrl(base, path) {
        return new URL(path, `${String(base).replace(/\/+$/, '')}/`).toString();
      },
      async request(fetchImpl, url, init = {}) {
        const response = await fetchImpl(url, {
          ...init,
          headers: {
            accept: 'application/json',
            origin: frontendOrigin,
            authorization: `Bearer ${jwt}`,
            ...(init.headers || {})
          },
          redirect: 'manual'
        });
        const body = await response.json().catch(() => null);
        if (response.ok) return { ok: true, status: response.status, data: body?.data ?? null };
        return {
          ok: false,
          status: response.status,
          error: { code: String(body?.error?.code || 'UNKNOWN') }
        };
      }
    };

    const page19Bridge = createHouseholdClaimBridge({ apiBase: apiOrigin, Session, complexSlug: COMPLEX_SLUG });
    const page26Bridge = createHouseholdClaimBridge({ apiBase: apiOrigin, Session, complexSlug: COMPLEX_SLUG });
    const [page19Raw, page26Raw] = await Promise.all([page19Bridge.getSnapshot(), page26Bridge.getSnapshot()]);
    const page19 = safeSnapshot(page19Raw);
    const page26 = safeSnapshot(page26Raw);

    if (JSON.stringify(page19) !== JSON.stringify(page26)) throw new Error('QA_DIAGNOSTIC_SAME_SESSION_DIVERGENCE');

    console.log(`HTTP_STATUS=${page19.status}`);
    console.log(`RESULT_OK=${page19.ok ? 'true' : 'false'}`);
    console.log(`ERROR_CODE=${page19.errorCode}`);
    console.log('AUTH_BRIDGE_DISPOSITION=SAME_SESSION_SAME_SNAPSHOT');
    console.log(`MY_MEMBERSHIP_STATUS=${page19.membershipStatus}`);
    console.log(`RESIDENT_VERIFIED=${page19.residentVerified ? 'true' : 'false'}`);
  } finally {
    if (cookie || sessionBearer) {
      await fetch(new URL('/api/auth/sign-out', apiOrigin), {
        method: 'POST',
        headers: { ...sessionHeaders(frontendOrigin, cookie, sessionBearer), 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual'
      }).catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'QA_DIAGNOSTIC_FAILED');
  process.exit(1);
});
