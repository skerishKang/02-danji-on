import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || '';
const mode = String(process.env.ADMIN_PROVISION_MODE || 'preflight').trim();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!dbUrl) {
  console.error('ADMIN_PRINCIPAL_PROVISION=FAIL missing production database URL');
  process.exit(1);
}
if (mode !== 'preflight' && mode !== 'apply') {
  console.error('ADMIN_PRINCIPAL_PROVISION=FAIL invalid mode');
  process.exit(1);
}

const principals = [
  {
    slot: 'super_1',
    role: 'admin',
    scopes: ['*'],
    email: process.env.DANJION_ADMIN_SUPER_1_EMAIL
  },
  {
    slot: 'super_2',
    role: 'admin',
    scopes: ['*'],
    email: process.env.DANJION_ADMIN_SUPER_2_EMAIL
  },
  {
    slot: 'operational_1',
    role: 'operator',
    scopes: ['benefit.manage', 'business.review', 'community.moderate', 'inquiry.respond', 'official-content.manage', 'resident.verification.exempt', 'resident.verification.manage', 'resident_news.review', 'safety.report.review'],
    email: process.env.DANJION_ADMIN_OPERATIONAL_1_EMAIL
  },
  {
    slot: 'operational_2',
    role: 'operator',
    scopes: ['benefit.manage', 'business.review', 'community.moderate', 'inquiry.respond', 'official-content.manage', 'resident.verification.exempt', 'resident.verification.manage', 'resident_news.review', 'safety.report.review'],
    email: process.env.DANJION_ADMIN_OPERATIONAL_2_EMAIL
  }
].map((principal) => ({
  ...principal,
  email: String(principal.email || '').trim().toLowerCase()
}));

if (
  principals.some((principal) => (
    principal.email.length < 3
    || principal.email.length > 254
    || !EMAIL_PATTERN.test(principal.email)
  ))
) {
  console.error('ADMIN_PRINCIPAL_PROVISION=FAIL four valid administrator identity secrets are required');
  process.exit(1);
}

if (new Set(principals.map((principal) => principal.email)).size !== 4) {
  console.error('ADMIN_PRINCIPAL_PROVISION=FAIL administrator identities must be pairwise distinct');
  process.exit(1);
}

const sql = neon(dbUrl);

async function readAggregateState() {
  const schemaRows = await sql.query(`
    select (to_regclass('public.padiem_admin_identity_allowlist') is not null)::int as present
  `, []);
  const schemaPresent = Number(schemaRows[0]?.present || 0);
  if (schemaPresent !== 1) {
    return {
      schema_present: schemaPresent,
      allowlist_total: null,
      active_principals: null,
      bootstrap_active_grant_rows: null,
      active_grant_rows: null
    };
  }

  const rows = await sql.query(`
    select
      (select count(*)::int from padiem_admin_identity_allowlist) as allowlist_total,
      (
        select count(*)::int
        from padiem_admin_identity_allowlist
        where status = 'active'
          and (expires_at is null or expires_at > now())
      ) as active_principals,
      (
        select count(*)::int
        from padiem_operator_grants
        where status = 'active'
          and (expires_at is null or expires_at > now())
          and metadata ->> 'source' = 'admin_identity_allowlist'
      ) as bootstrap_active_grant_rows,
      (
        select count(*)::int
        from padiem_operator_grants
        where status = 'active'
          and (expires_at is null or expires_at > now())
      ) as active_grant_rows
  `, []);
  const row = rows[0] || {};
  return {
    schema_present: 1,
    allowlist_total: Number(row.allowlist_total || 0),
    active_principals: Number(row.active_principals || 0),
    bootstrap_active_grant_rows: Number(row.bootstrap_active_grant_rows || 0),
    active_grant_rows: Number(row.active_grant_rows || 0)
  };
}

try {
  const before = await readAggregateState();
  console.log('ADMIN_PRINCIPAL_PROVISION_PREFLIGHT=PASS');
  console.log(JSON.stringify({
    mode,
    principal_secret_count: 4,
    super_target_count: 2,
    operational_target_count: 2,
    ...before
  }, null, 2));

  if (before.schema_present !== 1) {
    console.error('ADMIN_PRINCIPAL_PROVISION=FAIL allowlist schema is not present');
    process.exit(1);
  }

  if (mode === 'preflight') {
    console.log('ADMIN_PRINCIPAL_PROVISION_DISPOSITION=READ_ONLY');
    process.exit(0);
  }

  if (
    before.allowlist_total !== 0
    || before.active_principals !== 0
    || before.bootstrap_active_grant_rows !== 0
    || before.active_grant_rows !== 0
  ) {
    console.error('ADMIN_PRINCIPAL_PROVISION=FAIL initial provisioning requires an empty administrator state');
    process.exit(1);
  }

  const resultRows = await sql.query(`
    with input(slot, normalized_email, authority_level, scopes) as (
      values
        ('super_1', $1::text, 'admin', array['*']::text[]),
        ('super_2', $2::text, 'admin', array['*']::text[]),
        ('operational_1', $3::text, 'operator', array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[]),
        ('operational_2', $4::text, 'operator', array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[])
    ),
    guard as (
      select 1
      where (select count(*) from input) = 4
        and (select count(distinct normalized_email) from input) = 4
        and not exists (
          select 1 from padiem_admin_identity_allowlist
        )
        and not exists (
          select 1
          from padiem_operator_grants
          where status = 'active'
            and (expires_at is null or expires_at > now())
        )
    ),
    inserted as (
      insert into padiem_admin_identity_allowlist (
        provider,
        normalized_email,
        provider_account_id,
        authority_level,
        scopes,
        status,
        created_by_user_id,
        reason,
        metadata
      )
      select
        'google',
        i.normalized_email,
        null,
        i.authority_level,
        i.scopes,
        'active',
        null,
        'owner-approved initial Admin V1 principal provisioning',
        jsonb_build_object(
          'source', 'production_admin_principal_provision',
          'slot', i.slot
        )
      from input i
      cross join guard
      returning id, authority_level
    ),
    audited as (
      insert into audit_events (
        request_id,
        actor_user_id,
        actor_kind,
        complex_id,
        action,
        scope,
        resource_type,
        resource_id,
        decision,
        reason_code,
        metadata
      )
      select
        null,
        null,
        'system',
        null,
        'admin.principal.provision.initial',
        'platform.authz.manage',
        'administrator-principal-set',
        null,
        'allowed',
        'ADMIN_INITIAL_PRINCIPALS_PROVISIONED',
        jsonb_build_object(
          'principalCount', count(*),
          'superCount', count(*) filter (where authority_level = 'admin'),
          'operationalCount', count(*) filter (where authority_level = 'operator')
        )
      from inserted
      having count(*) = 4
      returning id
    )
    select
      (select count(*)::int from inserted) as inserted_count,
      (select count(*)::int from inserted where authority_level = 'admin') as super_count,
      (select count(*)::int from inserted where authority_level = 'operator') as operational_count,
      (select count(*)::int from audited) as audit_count
  `, principals.map((principal) => principal.email));

  const result = resultRows[0] || {};
  const insertedCount = Number(result.inserted_count || 0);
  const superCount = Number(result.super_count || 0);
  const operationalCount = Number(result.operational_count || 0);
  const auditCount = Number(result.audit_count || 0);

  if (
    insertedCount !== 4
    || superCount !== 2
    || operationalCount !== 2
    || auditCount !== 1
  ) {
    console.error('ADMIN_PRINCIPAL_PROVISION=FAIL atomic provisioning guard rejected the mutation');
    process.exit(1);
  }

  const after = await readAggregateState();
  if (
    after.allowlist_total !== 4
    || after.active_principals !== 4
    || after.bootstrap_active_grant_rows !== 0
    || after.active_grant_rows !== 0
  ) {
    console.error('ADMIN_PRINCIPAL_PROVISION=FAIL post-mutation aggregate readback mismatch');
    process.exit(1);
  }

  console.log('ADMIN_PRINCIPAL_PROVISION=PASS');
  console.log(JSON.stringify({
    inserted_count: insertedCount,
    super_count: superCount,
    operational_count: operationalCount,
    system_audit_count: auditCount,
    runtime_grant_rows_created: 0,
    postread_allowlist_total: after.allowlist_total,
    postread_active_principals: after.active_principals,
    postread_bootstrap_active_grant_rows: after.bootstrap_active_grant_rows,
    postread_active_grant_rows: after.active_grant_rows
  }, null, 2));
} catch {
  console.error('ADMIN_PRINCIPAL_PROVISION=FAIL database operation failed');
  process.exit(1);
}
