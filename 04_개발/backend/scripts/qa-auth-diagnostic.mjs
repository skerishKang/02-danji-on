import { fileURLToPath } from 'node:url';
import {
  ROOT_CLASS,
  MAX_RETRY_ATTEMPTS,
  classifyFailure,
  withBoundedRetry,
  resolveRootClass,
  checkCredentialBinding,
  safeBody,
  buildReport,
  isMutationPath
} from './qa-auth-diagnostic-classifier.mjs';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
const PRODUCTION_API_HOST = 'padiem-danjion-api-production.padiem.workers.dev';
const PRODUCTION_PAGES_HOST = 'danjion.pages.dev';

const PERSONAS = Object.freeze([
  { name: 'QA_SUPER', emailEnv: 'DANJION_QA_SUPER_EMAIL', passwordEnv: 'DANJION_QA_SUPER_PASSWORD' },
  { name: 'QA_OPERATIONAL', emailEnv: 'DANJION_QA_OPERATIONAL_EMAIL', passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD' },
  { name: 'QA_RESIDENT', emailEnv: 'DANJION_QA_RESIDENT_EMAIL', passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD' }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_AUTH_DIAG_MISSING_INPUT:${name}`);
  return value;
}

export function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_AUTH_DIAG_UNSAFE_TARGET:${name}`);
  }
  if (url.hostname === PRODUCTION_API_HOST || url.hostname === PRODUCTION_PAGES_HOST) {
    throw new Error(`QA_AUTH_DIAG_PRODUCTION_TARGET_FORBIDDEN:${name}`);
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

async function probe(label, url, fetchImpl, init = {}) {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'manual' });
    const bodyText = await response.text().catch(() => '');
    if (response.ok) return { label, rootClass: ROOT_CLASS.SUCCESS, status: response.status, detail: safeBody(bodyText) };
    const rootClass = classifyFailure({ stage: label, status: response.status, bodyText });
    return { label, rootClass, status: response.status, detail: safeBody(bodyText), retryAfter: response.headers.get('retry-after') };
  } catch (error) {
    const rootClass = classifyFailure({ stage: label, error });
    return { label, rootClass, status: 0, detail: 'network_exception', retryAfter: null };
  }
}

async function runSignin(frontendOrigin, persona, password, fetchImpl) {
  return withBoundedRetry(async (attempt) => {
    try {
      const response = await fetchImpl(new URL('/api/auth/sign-in/email', frontendOrigin), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
        body: JSON.stringify({ email: persona.email, password }),
        redirect: 'manual'
      });
      const bodyText = await response.text().catch(() => '');
      if (response.ok) {
        return {
          stage: 'signin',
          rootClass: ROOT_CLASS.SUCCESS,
          status: response.status,
          cookie: cookieHeader(response),
          bearer: response.headers.get('set-auth-token')?.trim() || '',
          detail: safeBody(bodyText),
          attempt
        };
      }
      const rootClass = classifyFailure({ stage: 'signin', status: response.status, bodyText });
      return { stage: 'signin', rootClass, status: response.status, detail: safeBody(bodyText), retryAfter: response.headers.get('retry-after'), attempt };
    } catch (error) {
      const rootClass = classifyFailure({ stage: 'signin', error });
      return { stage: 'signin', rootClass, status: 0, detail: 'network_exception', attempt };
    }
  }, {
    maxAttempts: MAX_RETRY_ATTEMPTS,
    onAttempt: ({ attempt, rootClass, stage }) => {
      console.log(`RETRY attempt=${attempt} stage=${stage} class=${rootClass}`);
    }
  });
}

async function runSession(frontendOrigin, signinResult, fetchImpl) {
  try {
    const response = await fetchImpl(new URL('/api/auth/get-session', frontendOrigin), {
      headers: authHeaders(frontendOrigin, signinResult.cookie, signinResult.bearer),
      redirect: 'manual'
    });
    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      return { stage: 'session', rootClass: classifyFailure({ stage: 'session', status: response.status, bodyText }), status: response.status, detail: safeBody(bodyText) };
    }
    const sessionBody = JSON.parse(bodyText || 'null');
    const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
    if (!subject) return { stage: 'session', rootClass: ROOT_CLASS.SESSION_FAILURE, status: response.status, detail: 'subject_missing' };
    let jwt = response.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const tokenResponse = await fetchImpl(new URL('/api/auth/token', frontendOrigin), {
        headers: authHeaders(frontendOrigin, signinResult.cookie, signinResult.bearer),
        redirect: 'manual'
      });
      const tokenBody = await tokenResponse.text().catch(() => '');
      if (!tokenResponse.ok) {
        return { stage: 'session', rootClass: classifyFailure({ stage: 'session', status: tokenResponse.status, bodyText: tokenBody }), status: tokenResponse.status, detail: safeBody(tokenBody) };
      }
      const parsed = JSON.parse(tokenBody || '{}');
      jwt = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
    }
    if (!jwt) return { stage: 'session', rootClass: ROOT_CLASS.SESSION_FAILURE, status: response.status, detail: 'jwt_missing' };
    return { stage: 'session', rootClass: ROOT_CLASS.SUCCESS, status: response.status, subject, jwt, detail: 'ok' };
  } catch (error) {
    return { stage: 'session', rootClass: classifyFailure({ stage: 'session', error }), status: 0, detail: 'network_exception' };
  }
}

async function runAuthority(apiOrigin, frontendOrigin, sessionResult, fetchImpl) {
  try {
    const response = await fetchImpl(new URL('/api/v1/me', apiOrigin), {
      headers: { accept: 'application/json', authorization: `Bearer ${sessionResult.jwt}`, origin: frontendOrigin },
      redirect: 'manual'
    });
    const bodyText = await response.text().catch(() => '');
    if (!response.ok) {
      return { stage: 'authority', rootClass: classifyFailure({ stage: 'authority', status: response.status, bodyText }), status: response.status, detail: safeBody(bodyText) };
    }
    return { stage: 'authority', rootClass: ROOT_CLASS.SUCCESS, status: response.status, detail: 'ok' };
  } catch (error) {
    return { stage: 'authority', rootClass: classifyFailure({ stage: 'authority', error }), status: 0, detail: 'network_exception' };
  }
}

export async function diagnosePersona(apiOrigin, frontendOrigin, persona, password, fetchImpl = fetch) {
  const binding = checkCredentialBinding(persona.passwordEnv, password);
  if (!binding.ok) {
    return {
      persona: persona.name,
      SIGNIN_STATUS: 0,
      SESSION_STATUS: 0,
      AUTHORITY_STATUS: 'NOT_REACHED',
      ROOT_CLASS: binding.rootClass,
      DETAIL: binding.reason,
      retries: 0
    };
  }

  const signin = await runSignin(frontendOrigin, persona, password, fetchImpl);
  const signinStatus = signin.status || 0;

  if (signin.rootClass !== ROOT_CLASS.SUCCESS) {
    return {
      persona: persona.name,
      SIGNIN_STATUS: signinStatus,
      SESSION_STATUS: 0,
      AUTHORITY_STATUS: 'NOT_REACHED',
      ROOT_CLASS: signin.rootClass,
      DETAIL: signin.detail,
      retries: signin.retries || 0,
      RETRY_AFTER: signin.retryAfter
    };
  }

  const session = await runSession(frontendOrigin, signin, fetchImpl);
  if (session.rootClass !== ROOT_CLASS.SUCCESS) {
    return {
      persona: persona.name,
      SIGNIN_STATUS: signinStatus,
      SESSION_STATUS: session.status || 0,
      AUTHORITY_STATUS: 'NOT_REACHED',
      ROOT_CLASS: session.rootClass,
      POST_SIGNIN: session.rootClass,
      DETAIL: session.detail,
      retries: signin.retries || 0
    };
  }

  const authority = await runAuthority(apiOrigin, frontendOrigin, session, fetchImpl);
  const rootClass = resolveRootClass([signin, session, authority]);
  return {
    persona: persona.name,
    SIGNIN_STATUS: signinStatus,
    SESSION_STATUS: session.status || 0,
    AUTHORITY_STATUS: authority.rootClass === ROOT_CLASS.SUCCESS ? 'PASS' : authority.rootClass,
    ROOT_CLASS: rootClass,
    DETAIL: authority.detail,
    retries: signin.retries || 0
  };
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_AUTH_DIAG_APP_ENV_MUST_BE_QA');
  if (process.env.DANJION_PRODUCTION_DB_URL) throw new Error('QA_AUTH_DIAG_PRODUCTION_DATABASE_VARIABLE_FORBIDDEN');
  if (process.env.DATABASE_URL) throw new Error('QA_AUTH_DIAG_GENERIC_DATABASE_URL_FORBIDDEN');

  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);

  const secretValues = PERSONAS.flatMap((persona) => [
    process.env[persona.passwordEnv] || '',
    process.env[persona.emailEnv] || ''
  ]).filter(Boolean);

  let writeCallCount = 0;
  const countingFetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && isMutationPath(url)) writeCallCount += 1;
    return fetch(input, init);
  };

  const probes = {};
  probes.health = await probe('health', new URL('/api/health', apiOrigin), countingFetch);
  probes.jwks = await probe('jwks', new URL('/api/auth/jwks', apiOrigin), countingFetch);

  const personas = {};
  for (const persona of PERSONAS) {
    const email = process.env[persona.emailEnv]?.trim() || '';
    const password = process.env[persona.passwordEnv] || '';
    const emailBinding = checkCredentialBinding(persona.emailEnv, email);
    if (!emailBinding.ok) {
      personas[persona.name] = {
        SIGNIN_STATUS: 0,
        SESSION_STATUS: 0,
        AUTHORITY_STATUS: 'NOT_REACHED',
        ROOT_CLASS: emailBinding.rootClass,
        DETAIL: emailBinding.reason,
        retries: 0
      };
      continue;
    }
    personas[persona.name] = await diagnosePersona(
      apiOrigin,
      frontendOrigin,
      { ...persona, email },
      password,
      countingFetch
    );
  }

  const report = buildReport({ personas, probes, writeCallCount, secretValues });
  console.log(JSON.stringify(report, null, 2));

  const anyFailure = Object.values(personas).some((persona) => persona.ROOT_CLASS !== ROOT_CLASS.SUCCESS);
  if (anyFailure) {
    console.error('QA_AUTH_DIAG_INCOMPLETE - see ROOT_CLASS values above');
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'QA_AUTH_DIAG_FAILED');
    process.exit(1);
  });
}
