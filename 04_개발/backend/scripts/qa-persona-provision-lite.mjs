import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'node:url';

/*
 * #868 QA acceptance personas - LITE lane.
 *
 * Why this exists next to qa-persona-provision.mjs:
 *   the full persona lane ends by converging a VERIFIED household fixture for the
 *   resident persona. #868 temporary-resident acceptance needs the opposite
 *   precondition - a signed-in member with NO verified household membership - and
 *   the acceptance itself forbids creating households or memberships. Reusing the
 *   full lane would therefore both violate that constraint and destroy the state
 *   under test.
 *
 * This lane is intentionally narrow:
 *   - it guarantees three QA credential actors exist and can sign in;
 *   - it converges ONLY `padiem_operator_grants` for them;
 *   - it NEVER creates or touches households, household_memberships,
 *     complex_memberships or complex_operator_grants;
 *   - it writes nothing outside the isolated QA environment.
 *
 * Identity policy: the three acceptance identities are pinned in source (the same
 * practice #823 already uses for the ordinary test-resident exemption). Pinning
 * removes the "which account does the CI secret hold?" ambiguity that made the
 * previous failure undiagnosable. Passwords stay in GitHub qa-environment secrets.
 *
 * Existing accounts are a NORMAL path: Better Auth answers
 * 422 USER_ALREADY_EXISTS, and the run continues to sign-in. A sign-in refusal is
 * then reported explicitly as a password mismatch instead of a generic failure.
 *
 * Desired PADIEM scopes (#868 acceptance):
 *   QA_SUPER    -> ['*']                      -> /api/v1/admin/authority level=admin
 *   QA_OPERATOR -> OPERATIONAL_ADMIN_SCOPES   -> level=operator
 *   QA_RESIDENT -> []                         -> no grant; temporary-mode subject
 */

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';

// Mirrors admin-scope-policy-v1.ts OPERATIONAL_ADMIN_SCOPES (source of record).
const OPERATIONAL_ADMIN_SCOPES = Object.freeze([
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident.verification.manage',
  'resident_news.review',
  'safety.report.review'
]);

const ACCOUNTS = Object.freeze([
  {
    name: 'QA_SUPER',
    email: 'skerish_super_test@naver.com',
    passwordEnv: 'DANJION_QA_SUPER_PASSWORD',
    desiredScopes: Object.freeze(['*'])
  },
  {
    name: 'QA_OPERATOR',
    email: 'skerish_manage_test@naver.com',
    passwordEnv: 'DANJION_QA_OPERATIONAL_PASSWORD',
    desiredScopes: OPERATIONAL_ADMIN_SCOPES
  },
  {
    name: 'QA_RESIDENT',
    email: 'skerish_people_test@naver.com',
    passwordEnv: 'DANJION_QA_RESIDENT_PASSWORD',
    desiredScopes: Object.freeze([])
  }
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_PERSONA_LITE_MISSING_INPUT:${name}`);
  return value;
}

export function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_PERSONA_LITE_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
}

function validateDatabaseUrl(raw) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('QA_PERSONA_LITE_DATABASE_URL_INVALID');
  if (/production|prod\b/i.test(url.hostname)) throw new Error('QA_PERSONA_LITE_PRODUCTION_DATABASE_FORBIDDEN');
  return raw;
}

// Never echo credentials, tokens or the database URL. Only the provider's own
// error code is kept, so a 500 stays diagnosable without leaking account detail.
function safeBody(raw) {
  const text = String(raw || '').slice(0, 400);
  const code = text.match(/"code"\s*:\s*"([A-Z0-9_]+)"/i);
  return code ? `code=${code[1]}` : 'code=UNPARSED';
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
  if (!response.ok) throw new Error(`QA_PERSONA_LITE_${label}_HTTP_${response.status}`);
}

export async function fetchPersonaMe(apiOrigin, frontendOrigin, jwt, personaName, fetchImpl = fetch) {
  const me = await fetchImpl(new URL('/api/v1/me', apiOrigin), {
    headers: { accept: 'application/json', authorization: `Bearer ${jwt}`, origin: frontendOrigin },
    redirect: 'manual'
  });
  await expectOk(`AUTH_BRIDGE_${personaName}`, me);
  return me;
}

function repairEnabled() {
  return String(process.env.QA_PERSONA_LITE_REPAIR || '').trim().toLowerCase() === 'true';
}

/**
 * READ-ONLY auth structure snapshot for one pinned QA identity.
 *
 * `INVALID_EMAIL_OR_PASSWORD` cannot distinguish "no such account" from "no
 * usable password credential", so the lane reports the actual row shape before
 * it decides anything. No hash, token, session id or address is printed - only
 * counts for the exact pinned identity.
 */
export async function readAuthStructure(sql, email) {
  const target = String(email).trim().toLowerCase();
  const rows = await sql`
    select
      u.id as user_id,
      u.email_verified as email_verified,
      (u.username is not null) as has_username,
      (select count(*) from danjion_auth.account a where a.user_id = u.id) as account_rows,
      (select count(*) from danjion_auth.account a where a.user_id = u.id and lower(a.provider_id) = 'credential') as credential_rows,
      (select count(*) from danjion_auth.account a
        where a.user_id = u.id and lower(a.provider_id) = 'credential' and a.password is not null) as password_rows,
      (select count(*) from danjion_auth.session s where s.user_id = u.id) as session_rows
    from danjion_auth."user" u
    where lower(u.email) = ${target}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { userRows: 0, accountRows: 0, credentialRows: 0, passwordRows: 0, sessionRows: 0 };
  return {
    userRows: 1,
    emailVerified: row.email_verified === true,
    hasUsername: row.has_username === true,
    accountRows: Number(row.account_rows || 0),
    credentialRows: Number(row.credential_rows || 0),
    passwordRows: Number(row.password_rows || 0),
    sessionRows: Number(row.session_rows || 0)
  };
}

export function formatAuthStructure(name, structure) {
  return [
    `AUTH_STRUCTURE=${name}`,
    `userRows=${structure.userRows}`,
    `emailVerified=${structure.emailVerified === true ? 'true' : 'false'}`,
    `accountRows=${structure.accountRows}`,
    `credentialRows=${structure.credentialRows}`,
    `passwordRows=${structure.passwordRows}`,
    `sessionRows=${structure.sessionRows}`
  ].join(' ');
}

/**
 * Repair a pinned QA identity that exists but cannot authenticate.
 *
 * Scope is deliberately tiny and bounded:
 *   - only ever called for the three pinned acceptance identities;
 *   - only ever when QA_PERSONA_LITE_REPAIR is exactly 'true' (an explicit
 *     manual-dispatch decision), never by default;
 *   - the single statement targets danjion_auth."user" by exact email. Sessions
 *     and account rows are removed by the existing ON DELETE CASCADE, so no
 *     other table is touched. app_users / households / memberships / grants are
 *     never deleted here.
 * The caller re-signs-up afterwards, which stores a fresh credential password
 * through Better Auth's own write path.
 */
export async function repairAuthAccount(sql, email) {
  const target = String(email).trim().toLowerCase();
  if (!ACCOUNTS.some((account) => account.email === target)) {
    throw new Error('QA_PERSONA_LITE_REPAIR_TARGET_NOT_PINNED');
  }
  await sql`delete from danjion_auth."user" where lower(email) = ${target}`;
}

/**
 * Guarantee the pinned QA identity exists and can sign in.
 *
 * 422 USER_ALREADY_EXISTS is the expected answer for an account that already
 * exists and is treated as success. Any other refusal is reported with its own
 * name: a 401/400 on sign-in means the stored QA credential is unusable, which
 * is a provisioning/data problem - not a product defect. With the explicit
 * repair flag set, such an identity is recreated once and re-signed-in.
 */
export async function acquireAccount(frontendOrigin, apiOrigin, sql, account, fetchImpl = fetch, repair = repairEnabled()) {
  const email = String(account.email).trim().toLowerCase();
  const password = required(account.passwordEnv);
  if (password.length < 8) throw new Error(`QA_PERSONA_LITE_PASSWORD_INVALID:${account.name}`);

  const structure = await readAuthStructure(sql, email);
  console.log(formatAuthStructure(account.name, structure));

  let created = false;
  const signUpOnce = async () => {
    const signup = await fetchImpl(new URL('/api/auth/sign-up/email', frontendOrigin), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
      body: JSON.stringify({ email, password, name: account.name }),
      redirect: 'manual'
    });
    const body = await signup.text().catch(() => '');
    if (signup.ok) return 'created';
    if (signup.status === 422) return 'existing';
    throw new Error(`QA_PERSONA_LITE_SIGNUP_HTTP_${signup.status}:${account.name}:${safeBody(body)}`);
  };
  const signInOnce = () => fetchImpl(new URL('/api/auth/sign-in/email', frontendOrigin), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
    body: JSON.stringify({ email, password }),
    redirect: 'manual'
  });

  created = (await signUpOnce()) === 'created';
  let signIn = await signInOnce();

  if (!signIn.ok && (signIn.status === 401 || signIn.status === 400) && repair) {
    console.log(`AUTH_REPAIR=${account.name} RECREATED`);
    await repairAuthAccount(sql, email);
    created = (await signUpOnce()) === 'created';
    signIn = await signInOnce();
  }

  if (!signIn.ok) {
    if (signIn.status === 401 || signIn.status === 400) {
      const after = repair ? await readAuthStructure(sql, email) : structure;
      throw new Error(`QA_PERSONA_LITE_SIGNIN_PASSWORD_MISMATCH:${account.name}:${formatAuthStructure(account.name, after)}`);
    }
    throw new Error(`QA_PERSONA_LITE_SIGNIN_HTTP_${signIn.status}:${account.name}`);
  }

  let cookie = '';
  let sessionBearer = '';
  try {
    cookie = cookieHeader(signIn);
    sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
    if (!cookie && !sessionBearer) throw new Error(`QA_PERSONA_LITE_SESSION_CREDENTIAL_MISSING:${account.name}`);

    const session = await fetchImpl(new URL('/api/auth/get-session', frontendOrigin), {
      headers: authHeaders(frontendOrigin, cookie, sessionBearer),
      redirect: 'manual'
    });
    await expectOk(`SESSION_${account.name}`, session);
    const sessionBody = await session.json().catch(() => null);
    const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
    if (!subject) throw new Error(`QA_PERSONA_LITE_AUTH_SUBJECT_MISSING:${account.name}`);

    let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const token = await fetchImpl(new URL('/api/auth/token', frontendOrigin), {
        headers: authHeaders(frontendOrigin, cookie, sessionBearer),
        redirect: 'manual'
      });
      await expectOk(`TOKEN_${account.name}`, token);
      const tokenBody = await token.json().catch(() => null);
      jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
    }
    if (!jwt) throw new Error(`QA_PERSONA_LITE_SERVICE_JWT_MISSING:${account.name}`);

    await fetchPersonaMe(apiOrigin, frontendOrigin, jwt, account.name, fetchImpl);

    const users = await sql`select id from app_users where auth_user_id = ${subject} limit 1`;
    if (!users[0]?.id) throw new Error(`QA_PERSONA_LITE_APP_USER_LINK_MISSING:${account.name}`);
    return { ...account, email, subject, userId: String(users[0].id), created };
  } finally {
    if (cookie || sessionBearer) {
      await fetchImpl(new URL('/api/auth/sign-out', frontendOrigin), {
        method: 'POST',
        headers: { ...authHeaders(frontendOrigin, cookie, sessionBearer), 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual'
      }).catch(() => null);
    }
  }
}

/**
 * Converge exactly the desired active PADIEM scopes and nothing else.
 * An empty desired set REVOKES every active grant - the temporary-resident lane
 * must never carry operator authority.
 */
export async function convergePadiemGrants(sql, actor) {
  const desired = [...actor.desiredScopes];
  if (desired.length === 0) {
    await sql`
      update padiem_operator_grants
      set status = 'revoked', revoked_at = now(), reason = 'qa persona lite convergence',
          metadata = jsonb_build_object('source','qa_persona_provision_lite','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid and status = 'active'
    `;
  } else {
    await sql`
      update padiem_operator_grants
      set status = 'revoked', revoked_at = now(), reason = 'qa persona lite convergence',
          metadata = jsonb_build_object('source','qa_persona_provision_lite','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid
        and status = 'active'
        and not (scope = any(${desired}::text[]))
    `;
  }

  for (const scope of desired) {
    await sql`
      update padiem_operator_grants
      set expires_at = null, revoked_at = null, reason = 'qa persona lite convergence',
          metadata = jsonb_build_object('source','qa_persona_provision_lite','persona',${actor.name}::text)
      where user_id = ${actor.userId}::uuid and scope = ${scope} and status = 'active'
    `;
    await sql`
      insert into padiem_operator_grants (user_id, scope, status, granted_by_user_id, expires_at, revoked_at, reason, metadata)
      select ${actor.userId}::uuid, ${scope}, 'active', null, null, null, 'qa persona lite convergence',
             jsonb_build_object('source','qa_persona_provision_lite','persona',${actor.name}::text)
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
    throw new Error(`QA_PERSONA_LITE_GRANT_READBACK_MISMATCH:${actor.name}`);
  }
  return actual;
}

/**
 * READ-ONLY. This lane must never create household or membership state, and the
 * #868 temporary-resident lane additionally needs a principal with NO verified
 * membership. Both facts are measured, never mutated.
 */
export async function readResidentState(sql, actor) {
  const rows = await sql`
    select
      (select count(*) from household_memberships where user_id = ${actor.userId}::uuid) as household_memberships,
      (select count(*) from household_memberships where user_id = ${actor.userId}::uuid and status = 'verified') as verified_household_memberships,
      (select count(*) from complex_memberships where user_id = ${actor.userId}::uuid) as complex_memberships,
      (select count(*) from complex_operator_grants where user_id = ${actor.userId}::uuid and status = 'active') as complex_operator_grants
  `;
  const row = rows[0] || {};
  return {
    householdMemberships: Number(row.household_memberships || 0),
    verifiedHouseholdMemberships: Number(row.verified_household_memberships || 0),
    complexMemberships: Number(row.complex_memberships || 0),
    complexOperatorGrants: Number(row.complex_operator_grants || 0)
  };
}

function reportActor(actor, scopes, residentState) {
  const wildcard = scopes.includes('*');
  const authorityLevel = wildcard ? 'admin' : scopes.length ? 'operator' : 'none';
  console.log(`PERSONA=${actor.name}`);
  console.log('AUTH=PASS');
  console.log(`ACCOUNT_CREATED=${actor.created ? 'true' : 'false'}`);
  console.log(`AUTHORITY_LEVEL=${authorityLevel}`);
  console.log(`WILDCARD=${wildcard ? 'true' : 'false'}`);
  console.log(`BOUNDED_SCOPE_COUNT=${scopes.filter((scope) => scope !== '*').length}`);
  console.log(`HOUSEHOLD_MEMBERSHIP_COUNT=${residentState.householdMemberships}`);
  console.log(`VERIFIED_HOUSEHOLD_MEMBERSHIP=${residentState.verifiedHouseholdMemberships > 0 ? 'true' : 'false'}`);
  console.log(`COMPLEX_MEMBERSHIP_COUNT=${residentState.complexMemberships}`);
  console.log(`COMPLEX_OPERATOR_GRANT_COUNT=${residentState.complexOperatorGrants}`);
  console.log('HOUSEHOLD_FIXTURE=NOT_RUN');
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_PERSONA_LITE_APP_ENV_MUST_BE_QA');
  if (process.env.DATABASE_URL) throw new Error('QA_PERSONA_LITE_GENERIC_DATABASE_URL_FORBIDDEN');
  if (process.env.DANJION_PRODUCTION_DB_URL) throw new Error('QA_PERSONA_LITE_PRODUCTION_DATABASE_VARIABLE_FORBIDDEN');

  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);
  const databaseUrl = validateDatabaseUrl(required('DANJION_QA_DATABASE_URL'));

  if (new Set(ACCOUNTS.map(({ email }) => email)).size !== ACCOUNTS.length) {
    throw new Error('QA_PERSONA_LITE_IDENTITIES_MUST_BE_DISTINCT');
  }

  const repair = repairEnabled();
  if (repair) console.log('AUTH_REPAIR_MODE=ON');

  const sql = neon(databaseUrl);
  const actors = [];
  for (const account of ACCOUNTS) actors.push(await acquireAccount(frontendOrigin, apiOrigin, sql, account, fetch, repair));

  if (new Set(actors.map(({ subject }) => subject)).size !== ACCOUNTS.length) {
    throw new Error('QA_PERSONA_LITE_AUTH_SUBJECTS_MUST_BE_DISTINCT');
  }
  if (new Set(actors.map(({ userId }) => userId)).size !== ACCOUNTS.length) {
    throw new Error('QA_PERSONA_LITE_APP_USERS_MUST_BE_DISTINCT');
  }

  for (const actor of actors) {
    const [scopes, residentState] = [
      await convergePadiemGrants(sql, actor),
      await readResidentState(sql, actor)
    ];
    reportActor(actor, scopes, residentState);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'QA_PERSONA_LITE_FAILED');
    process.exit(1);
  });
}
