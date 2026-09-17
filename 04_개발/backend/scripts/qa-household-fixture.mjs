import { neon } from '@neondatabase/serverless';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
const SYNTHETIC_COMPLEX_SLUG = process.env.DANJION_QA_COMPLEX_SLUG?.trim() || 'banglim-myeongji-roadhill';
const SYNTHETIC_COMPLEX_NAME = process.env.DANJION_QA_COMPLEX_NAME?.trim() || '방림명지로드힐';
const SYNTHETIC_BUILDING = 'qa-building';
const SYNTHETIC_UNIT = 'qa-unit';
const DISPOSITIONS = new Set([
  'HOUSEHOLD_ASSOCIATED_RESIDENT_PENDING',
  'HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED'
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_FIXTURE_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_FIXTURE_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
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
  if (!response.ok) throw new Error(`QA_FIXTURE_${label}_HTTP_${response.status}`);
}

async function main() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_FIXTURE_APP_ENV_MUST_BE_QA');
  if (process.env.DATABASE_URL) throw new Error('QA_FIXTURE_GENERIC_DATABASE_URL_FORBIDDEN');

  const apiOrigin = exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST);
  const frontendOrigin = exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST);
  const databaseUrl = required('DANJION_QA_DATABASE_URL');
  const email = required('DANJION_QA_EMAIL');
  const password = required('DANJION_QA_PASSWORD');
  const disposition = required('QA_FIXTURE_DISPOSITION');
  if (!DISPOSITIONS.has(disposition)) throw new Error('QA_FIXTURE_DISPOSITION_INVALID');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('QA_FIXTURE_DATABASE_URL_INVALID');
  if (password.length < 8) throw new Error('QA_FIXTURE_PASSWORD_INVALID');

  const api = (path) => new URL(path, apiOrigin);
  let cookie = '';
  let sessionBearer = '';

  try {
    const signIn = await fetch(api('/api/auth/sign-in/email'), {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', origin: frontendOrigin },
      body: JSON.stringify({ email, password }),
      redirect: 'manual'
    });
    await expectOk('SIGNIN', signIn);
    cookie = cookieHeader(signIn);
    sessionBearer = signIn.headers.get('set-auth-token')?.trim() || '';
    if (!cookie && !sessionBearer) throw new Error('QA_FIXTURE_SESSION_CREDENTIAL_MISSING');

    const session = await fetch(api('/api/auth/get-session'), {
      headers: authHeaders(frontendOrigin, cookie, sessionBearer),
      redirect: 'manual'
    });
    await expectOk('SESSION', session);
    const sessionBody = await session.json().catch(() => null);
    const subject = typeof sessionBody?.user?.id === 'string' ? sessionBody.user.id.trim() : '';
    if (!subject) throw new Error('QA_FIXTURE_AUTH_SUBJECT_MISSING');

    let jwt = session.headers.get('set-auth-jwt')?.trim() || '';
    if (!jwt) {
      const token = await fetch(api('/api/auth/token'), {
        headers: authHeaders(frontendOrigin, cookie, sessionBearer),
        redirect: 'manual'
      });
      await expectOk('TOKEN', token);
      const tokenBody = await token.json().catch(() => null);
      jwt = typeof tokenBody?.token === 'string' ? tokenBody.token.trim() : '';
    }
    if (!jwt) throw new Error('QA_FIXTURE_SERVICE_JWT_MISSING');

    const me = await fetch(api('/api/v1/me'), {
      headers: { accept: 'application/json', authorization: `Bearer ${jwt}`, origin: frontendOrigin },
      redirect: 'manual'
    });
    await expectOk('AUTH_BRIDGE', me);

    const sql = neon(databaseUrl);
    const users = await sql`select id from app_users where auth_user_id = ${subject} limit 1`;
    if (!users[0]?.id) throw new Error('QA_FIXTURE_APP_USER_LINK_MISSING');
    const userId = String(users[0].id);

    const complexes = await sql`
      insert into complexes (slug, name, status)
      values (${SYNTHETIC_COMPLEX_SLUG}, ${SYNTHETIC_COMPLEX_NAME}, 'pilot')
      on conflict (slug) do update set name = excluded.name, status = 'pilot', updated_at = now()
      returning id
    `;
    const complexId = String(complexes[0].id);

    const units = await sql`
      insert into complex_units (complex_id, building_code, unit_code, status)
      values (${complexId}::uuid, ${SYNTHETIC_BUILDING}, ${SYNTHETIC_UNIT}, 'active')
      on conflict (complex_id, building_code, unit_code)
      do update set status = 'active', updated_at = now()
      returning id
    `;
    const unitId = String(units[0].id);

    const households = await sql`
      insert into households (complex_id, complex_unit_id, status)
      values (${complexId}::uuid, ${unitId}::uuid, 'active')
      on conflict (complex_unit_id)
      do update set status = 'active', updated_at = now()
      returning id
    `;
    const householdId = String(households[0].id);

    const verified = disposition === 'HOUSEHOLD_ASSOCIATED_RESIDENT_VERIFIED';
    const residentStatus = verified ? 'verified' : 'pending';
    const householdStatus = verified ? 'verified' : 'pending';

    await sql`
      insert into complex_memberships (complex_id, user_id, role, verification_status, verified_at)
      values (${complexId}::uuid, ${userId}::uuid, 'resident', ${residentStatus}, ${verified ? new Date().toISOString() : null}::timestamptz)
      on conflict (complex_id, user_id)
      do update set
        role = 'resident',
        verification_status = excluded.verification_status,
        verified_at = excluded.verified_at,
        updated_at = now()
    `;

    const activeHousehold = await sql`
      select id from household_memberships
      where complex_id = ${complexId}::uuid
        and user_id = ${userId}::uuid
        and status in ('pending','verified')
      order by created_at asc
      limit 1
    `;

    if (activeHousehold[0]?.id) {
      await sql`
        update household_memberships
        set household_id = ${householdId}::uuid,
            membership_role = 'primary',
            status = ${householdStatus},
            verified_at = ${verified ? new Date().toISOString() : null}::timestamptz,
            revoked_at = null,
            updated_at = now()
        where id = ${String(activeHousehold[0].id)}::uuid
      `;
    } else {
      await sql`
        insert into household_memberships (
          complex_id, household_id, user_id, membership_role, status, verified_at, revoked_at
        ) values (
          ${complexId}::uuid,
          ${householdId}::uuid,
          ${userId}::uuid,
          'primary',
          ${householdStatus},
          ${verified ? new Date().toISOString() : null}::timestamptz,
          null
        )
      `;
    }

    const state = await sql`
      select
        cm.verification_status as resident_status,
        hm.status as household_status,
        exists (
          select 1 from resident_verifications rv
          where rv.membership_id = cm.id
        ) as has_verification_evidence,
        exists (
          select 1 from padiem_operator_grants g where g.user_id = ${userId}::uuid and g.status = 'active'
        ) as has_padiem_grant,
        exists (
          select 1 from complex_operator_grants g where g.user_id = ${userId}::uuid and g.status = 'active'
        ) as has_complex_operator_grant
      from complex_memberships cm
      join household_memberships hm
        on hm.complex_id = cm.complex_id
       and hm.user_id = cm.user_id
       and hm.status in ('pending','verified')
      where cm.complex_id = ${complexId}::uuid
        and cm.user_id = ${userId}::uuid
      limit 1
    `;
    const row = state[0];
    if (!row) throw new Error('QA_FIXTURE_READBACK_MISSING');
    if (Boolean(row.has_verification_evidence)) throw new Error('QA_FIXTURE_VERIFICATION_EVIDENCE_FORBIDDEN');
    if (Boolean(row.has_padiem_grant) || Boolean(row.has_complex_operator_grant)) throw new Error('QA_FIXTURE_OPERATOR_GRANT_FORBIDDEN');
    if (String(row.resident_status) !== residentStatus || String(row.household_status) !== householdStatus) {
      throw new Error('QA_FIXTURE_READBACK_MISMATCH');
    }

    console.log(`QA_FIXTURE_DISPOSITION=${disposition}`);
    console.log('HOUSEHOLD_ASSOCIATED=true');
    console.log(`MY_MEMBERSHIP_STATUS=${residentStatus}`);
    console.log(`RESIDENT_VERIFIED=${verified ? 'true' : 'false'}`);
    console.log('VERIFICATION_EVIDENCE_PRESENT=false');
    console.log('OPERATOR_GRANT_PRESENT=false');
    console.log('PRODUCTION_TARGET=NO');
    console.log('SECRET_OUTPUT=NO');
  } finally {
    if (cookie || sessionBearer) {
      await fetch(api('/api/auth/sign-out'), {
        method: 'POST',
        headers: { ...authHeaders(frontendOrigin, cookie, sessionBearer), 'content-type': 'application/json' },
        body: '{}',
        redirect: 'manual'
      }).catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'QA_FIXTURE_FAILED');
  process.exit(1);
});
