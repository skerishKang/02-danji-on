import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'node:url';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
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
  {
    name: 'QA_RESIDENT',
    emailEnv: 'DANJION_QA_RESIDENT_EMAIL',
    passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD',
    desiredScopes: []
  },
  {
    name: 'QA_OPERATIONAL',
    emailEnv: 'DANJION_QA_OPERATIONAL_EMAIL',
    passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD',
    desiredScopes: OPERATIONAL_SCOPES
  },
  {
    name: 'QA_SUPER',
    emailEnv: 'DANJION_QA_SUPER_EMAIL',
    passwordEnv: 'DANJION_QA_SUPER_PASSWORD',
    desiredScopes: ['*']
  }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_PERSONA_MISSING_INPUT:${name}`);
  return value;
}

export function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_PERSONA_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
}

function validateDatabaseUrl(raw) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('QA_PERSONA_DATABASE_URL_INVALID');
  if (/production|prod\b/i.test(url.hostname)) throw new Error('QA_PERSONA_PRODUCTION_DATABASE_FORBIDDEN');
  return raw;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return values.map((value) => value.split(';', 1)[0]?.trim()).filter(Boolean).join('; ');
}

function authHeaders(origin, cookie, sessionBearer) {
  return {
    accept: 'application/json',
    origin,
    ...(cookie ? { cookie } : {}),
    ...(sessionBearer ? { authorization: `Bearer ${sessionBearer}` } : {})
  };
}

async function expectOk(label, response) {
  if (!response.ok) throw new Error(`QA_PERSONA_${label}_HTTP_${response.status}`);
}

export async function fetchPersonaMe(apiOrigin, frontendOrigin, jwt, personaName, fetchImpl = fetch) {
  const me = await fetchImpl(new URL('/api/v1/me', apiOrigin), {
    headers: { accept: 'application/json', authorization: `Bearer ${jwt}`, origin: frontendOrigin },
    redirect: 'manual'
  });
  await expectOk(`AUTH_BRIDGE_${personaName}`, me);
  return me;
}

export async function resolvePersona(frontendOrigin, apiOrigin, sql, persona) {
  const email = required(persona.emailEnv).toLowerCase();
  const password = required(persona.passwordEnv);
  if (password.length < 8) throw new Error(`QA_PERSONA_PASSWORD_INVALID:${persona.name}`);

  const signup = await fetch(new URL('/api/auth/sign-up/email', frontendOrigin), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
    body: JSON.stringify({ email, password, name: persona.name }),
    redirect: 'manual'
  });
  if (signup.status >= 500) throw new Error(`QA_PERSONA_SIGNUP_HTTP_${signup.status}:${persona.name}`);

  let cookie = '';
  let sessionBearer = '';
  try {
    const signIn = await fetch(new URL('/api/auth/sign-in/email', frontendOrigin), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
      body: JSON.stringify({ email, password }),
      redirect: 'manual'
    });
    await expectOk(`SIGNIN_${persona.name}`, signIn);
    cookie = cookieHeader(signIn);
    sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
    if (!cookie && !sessionBearer) throw new Error(`QA_PERSONA_SESSION_CREDENTIAL_MISSING:${persona.name}`);

    const session = await fetch(new URL('/api/auth/get-session', frontendOrigin), {
      headers: authHeaders(frontendOrigin, cookie, sessionBearer),
      redirect: 'manual'
    });
    await expectOk(`SESSION_${persona.name}`, session);
    const sessionBody = await session.json().catch(() => null);
    const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
    if (!subject) throw new Error(`QA_PERSONA_AUTH_SUBJECT_MISSING:${persona.name}`);

    let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const token = await fetch(new URL('/api/auth/token', frontendOrigin), {
        headers: authHeaders(frontendOrigin, cookie, sessionBearer),
        redirect: 'manual'
      });
      await expectOk(`TOKEN_${persona.name}`, token);
      const tokenBody = await token.json().catch(() => null);
      jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
    }
    if (!jwt) throw new Error(`QA_PERSONA_SERVICE_JWT_MISSING:${persona.name}`);

    await fetchPersonaMe(apiOrigin, frontendOrigin, jwt, persona.name);

    const users = await sql`select id from app_users where auth_user_id = ${subject} limit 1`;
    if (!users[0]?.id) throw new Error(`QA_PERSONA_APP_USER_LINK_MISSING:${persona.name}`);
    return { ...persona, email, subject, userId: String(users[0].id) };
  } finally {
    if (cookie || sessionBearer) {
      await fetch(new URL('/api/auth/sign-out', frontendOrigin), {
        method: 'POST',
        headers: { ...authHeaders(frontendOrigin, cookie, sessionBearer), 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual'
      }).catch(() => null);
    }
  }
}

async function assertNoResidentContamination(sql, actor) {
  if (actor.name === 'QA_RESIDENT') return;
  const rows = await sql`
    select
      exists(select 1 from complex_memberships where user_id = ${actor.userId}::uuid) as has_complex_membership,
      exists(select 1 from household_memberships where user_id = ${actor.userId}::uuid) as has_household_membership,
      exists(select 1 from complex_operator_grants where user_id = ${actor.userId}::uuid and status = 'active') as has_complex_operator_grant
  `;
  const row = rows[0] || {};
  if (Boolean(row.has_complex_membership) || Boolean(row.has_household_membership) || Boolean(row.has_complex_operator_grant)) {
    throw new Error(`QA_PERSONA_RESIDENT_CONTAMINATION:${actor.name}`);
  }
}

async function assertResidentHasNoComplexOperatorGrant(sql, actor) {
  if (actor.name !== 'QA_RESIDENT') return;
  const rows = await sql`
    select exists(
      select 1 from complex_operator_grants
      where user_id = ${actor.userId}::uuid and status = 'active'
    ) as present
  `;
  if (Boolean(rows[0]?.present)) throw new Error('QA_PERSONA_RESIDENT_COMPLEX_OPERATOR_GRANT_FORBIDDEN');
}

async function convergePadiemGrants(sql, actor) {
  const desired = [...actor.desiredScopes];
  if (desired.length === 0) {
    await sql`
      update padiem_operator_grants
      set status = 'revoked', revoked_at = now(), reason = 'qa persona convergence',
          metadata = jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid and status = 'active'
    `;
  } else {
    await sql`
      update padiem_operator_grants
      set status = 'revoked', revoked_at = now(), reason = 'qa persona convergence',
          metadata = jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid
        and status = 'active'
        and not (scope = any(${desired}::text[]))
    `;
  }

  for (const scope of desired) {
    await sql`
      update padiem_operator_grants
      set expires_at = null, revoked_at = null, reason = 'qa persona convergence',
          metadata = jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid and scope = ${scope} and status = 'active'
    `;
    await sql`
      insert into padiem_operator_grants (user_id, scope, status, granted_by_user_id, expires_at, revoked_at, reason, metadata)
      select ${actor.userId}::uuid, ${scope}, 'active', null, null, null, 'qa persona convergence',
             jsonb_build_object('source','qa_persona_provision','persona',${actor.name}::text)
      where not exists (
        select 1 from padiem_operator_grants
        where user_id = ${actor.userId}::uuid and scope = ${scope} and status = 'active'
      )
    `;
  }

  const rows = await sql`
    select scope
    from padiem_operator_grants
    where user_id = ${actor.userId}::uuid
      and status = 'active'
      and (expires_at is null or expires_at > now())
    order by scope
  `;
  const actual = rows.map((row) => String(row.scope));
  const expected = [...desired].sort();
  if (actual.length !== expected.length || actual.some((scope, index) => scope !== expected[index])) {
    throw new Error(`QA_PERSONA_GRANT_READBACK_MISMATCH:${actor.name}`);
  }
  return actual;
}

function reportAuthority(actor, scopes) {
  if (actor.name === 'QA_RESIDENT') return;
  const wildcard = scopes.includes('*');
  const authorityLevel = wildcard ? 'admin' : scopes.length ? 'operator' : 'none';
  const boundedCount = scopes.filter((scope) => scope !== '*').length;
  console.log(`PERSONA=${actor.name}`);
  console.log('AUTH=PASS');
  console.log('RESIDENT_VERIFIED=false');
  console.log(`AUTHORITY_LEVEL=${authorityLevel}`);
  console.log(`WILDCARD=${wildcard ? 'true' : 'false'}`);
  console.log(`BOUNDED_SCOPE_COUNT=${boundedCount}`);
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_PERSONA_APP_ENV_MUST_BE_QA');
  if (process.env.DATABASE_URL) throw new Error('QA_PERSONA_GENERIC_DATABASE_URL_FORBIDDEN');
  if (process.env.DANJION_PRODUCTION_DB_URL) throw new Error('QA_PERSONA_PRODUCTION_DATABASE_VARIABLE_FORBIDDEN');

  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);
  const databaseUrl = validateDatabaseUrl(required('DANJION_QA_DATABASE_URL'));

  const credentials = PERSONAS.map((persona) => ({
    email: required(persona.emailEnv).toLowerCase(),
    password: required(persona.passwordEnv)
  }));
  if (new Set(credentials.map(({ email }) => email)).size !== PERSONAS.length) {
    throw new Error('QA_PERSONA_IDENTITIES_MUST_BE_DISTINCT');
  }

  const sql = neon(databaseUrl);
  const actors = [];
  for (const persona of PERSONAS) actors.push(await resolvePersona(frontendOrigin, apiOrigin, sql, persona));

  if (new Set(actors.map(({ subject }) => subject)).size !== PERSONAS.length) {
    throw new Error('QA_PERSONA_AUTH_SUBJECTS_MUST_BE_DISTINCT');
  }
  if (new Set(actors.map(({ userId }) => userId)).size !== PERSONAS.length) {
    throw new Error('QA_PERSONA_APP_USERS_MUST_BE_DISTINCT');
  }

  for (const actor of actors) {
    await assertResidentHasNoComplexOperatorGrant(sql, actor);
    await assertNoResidentContamination(sql, actor);
    const scopes = await convergePadiemGrants(sql, actor);
    reportAuthority(actor, scopes);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'QA_PERSONA_PROVISION_FAILED');
    process.exit(1);
  });
}
