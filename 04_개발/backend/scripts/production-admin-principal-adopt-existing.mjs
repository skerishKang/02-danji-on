import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || '';
const mode = String(process.env.ADMIN_ADOPTION_MODE || 'preflight').trim();
const ADOPTION_MARKER = 'admin-v1-existing-four-626';

if (!dbUrl) {
  console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL missing production database URL');
  process.exit(1);
}
if (!['preflight', 'apply', 'rollback'].includes(mode)) {
  console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL invalid mode');
  process.exit(1);
}

const sql = neon(dbUrl);

const BASE_CTES = `
  active_grants as materialized (
    select id, user_id, scope, metadata
    from padiem_operator_grants
    where status = 'active'
      and (expires_at is null or expires_at > now())
  ),
  by_user as materialized (
    select
      user_id,
      array_agg(distinct scope order by scope) as scopes,
      count(*)::int as grant_rows
    from active_grants
    group by user_id
  ),
  classified as materialized (
    select
      user_id,
      scopes,
      grant_rows,
      case
        when cardinality(scopes) = 10
          and scopes @> array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[]
          and array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
          then 'admin'
        when cardinality(scopes) = 9
          and array_position(scopes, '*') is null
          and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[]
          and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[] @> scopes
          then 'operator'
        else 'other'
      end as authority_role
    from by_user
  ),
  candidates as materialized (
    select user_id, scopes, grant_rows, authority_role
    from classified
    where authority_role in ('admin', 'operator')
  ),
  identity_state as materialized (
    select
      c.user_id,
      c.authority_role,
      c.grant_rows,
      au.auth_user_id,
      au.account_status,
      lower(btrim(u.email)) as normalized_email,
      u.email_verified,
      (
        select count(*)::int
        from danjion_auth.account a
        where a.user_id = u.id
          and lower(a.provider_id) = 'google'
      ) as google_account_count,
      (
        select max(a.account_id)
        from danjion_auth.account a
        where a.user_id = u.id
          and lower(a.provider_id) = 'google'
      ) as google_account_id,
      (
        select count(*)::int
        from danjion_auth.account a
        where a.user_id = u.id
          and lower(a.provider_id) = 'credential'
      ) as credential_account_count,
      (
        select max(a.account_id)
        from danjion_auth.account a
        where a.user_id = u.id
          and lower(a.provider_id) = 'credential'
      ) as credential_account_id
    from candidates c
    left join app_users au on au.id = c.user_id
    left join danjion_auth."user" u on u.id = au.auth_user_id
  ),
  candidate_grants as materialized (
    select g.*
    from active_grants g
    join candidates c on c.user_id = g.user_id
  )
`;

function numeric(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('unexpected non-numeric aggregate');
  return parsed;
}

async function readState() {
  const rows = await sql.query(`
    with
    ${BASE_CTES}
    select
      (to_regclass('public.padiem_admin_identity_allowlist') is not null)::int as schema_present,
      (select count(*)::int from padiem_admin_identity_allowlist) as allowlist_total,
      (
        select count(*)::int
        from padiem_admin_identity_allowlist
        where status = 'active'
          and (expires_at is null or expires_at > now())
      ) as allowlist_active,
      (
        select count(*)::int
        from padiem_admin_identity_allowlist
        where status = 'active'
          and (expires_at is null or expires_at > now())
          and authority_level = 'admin'
          and scopes = array['*']::text[]
      ) as allowlist_super,
      (
        select count(*)::int
        from padiem_admin_identity_allowlist
        where status = 'active'
          and (expires_at is null or expires_at > now())
          and authority_level = 'operator'
          and cardinality(scopes) = 9
          and array_position(scopes, '*') is null
          and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[]
          and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[] @> scopes
      ) as allowlist_operational,
      (select count(*)::int from active_grants) as active_grant_rows,
      (select count(*)::int from classified where authority_role = 'admin') as super_users,
      (select count(*)::int from classified where authority_role = 'operator') as operational_users,
      (select count(*)::int from classified where authority_role = 'other') as other_users,
      (select count(*)::int from candidates) as candidate_users,
      coalesce((select sum(grant_rows)::int from candidates), 0) as candidate_grant_rows,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
      ) as active_identity_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and normalized_email is not null
          and char_length(normalized_email) between 3 and 254
          and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      ) as valid_normalized_email_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and email_verified = true
      ) as email_verified_true_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and email_verified = false
      ) as email_verified_false_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and email_verified = true
          and normalized_email is not null
          and char_length(normalized_email) between 3 and 254
          and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      ) as verified_email_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and google_account_count = 1
          and google_account_id is not null
      ) as one_google_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and google_account_count = 0
      ) as zero_google_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and google_account_count > 1
      ) as multiple_google_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and credential_account_count = 1
          and credential_account_id is not null
      ) as one_credential_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and credential_account_count = 0
      ) as zero_credential_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and credential_account_count > 1
      ) as multiple_credential_account_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and google_account_count = 1
          and credential_account_count = 0
          and google_account_id is not null
          and email_verified = true
      ) as ready_google_identity_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and credential_account_count = 1
          and google_account_count = 0
          and credential_account_id is not null
      ) as ready_credential_identity_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and (
            (google_account_count = 1 and credential_account_count = 0 and google_account_id is not null and email_verified = true)
            or
            (credential_account_count = 1 and google_account_count = 0 and credential_account_id is not null)
          )
      ) as ready_identity_users,
      (
        select count(*)::int
        from identity_state
        where authority_role = 'admin'
          and auth_user_id is not null
          and account_status = 'active'
          and (
            (google_account_count = 1 and credential_account_count = 0 and google_account_id is not null and email_verified = true)
            or
            (credential_account_count = 1 and google_account_count = 0 and credential_account_id is not null)
          )
      ) as ready_super_users,
      (
        select count(*)::int
        from identity_state
        where authority_role = 'operator'
          and auth_user_id is not null
          and account_status = 'active'
          and (
            (google_account_count = 1 and credential_account_count = 0 and google_account_id is not null and email_verified = true)
            or
            (credential_account_count = 1 and google_account_count = 0 and credential_account_id is not null)
          )
      ) as ready_operational_users,
      (
        select count(*)::int
        from identity_state
        where auth_user_id is not null
          and account_status = 'active'
          and (google_account_count + credential_account_count) <> 1
      ) as ambiguous_supported_provider_users,
      (
        select count(distinct normalized_email)::int
        from identity_state
        where normalized_email is not null
      ) as distinct_normalized_emails,
      (
        select count(distinct
          case
            when google_account_count = 1 and credential_account_count = 0 and google_account_id is not null
              then 'google:' || google_account_id
            when credential_account_count = 1 and google_account_count = 0 and credential_account_id is not null
              then 'credential:' || credential_account_id
            else null
          end
        )::int
        from identity_state
      ) as distinct_supported_provider_accounts,
      (
        select count(*)::int
        from candidate_grants
        where metadata ?| array['source','principalId','provider','adoptionMarker']
      ) as reserved_metadata_collision_rows,
      (
        select count(*)::int
        from active_grants
        where metadata ->> 'source' = 'admin_identity_allowlist'
          and nullif(metadata ->> 'principalId', '') is not null
      ) as principal_linked_active_grant_rows,
      (
        select count(*)::int
        from active_grants
        where metadata ->> 'adoptionMarker' = '${ADOPTION_MARKER}'
      ) as adoption_marked_active_grant_rows
  `, []);
  const row = rows[0] || {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numeric(value)]));
}

function providerAwareIdentityReady(state) {
  return state.ready_identity_users === 4
    && state.ready_super_users === 2
    && state.ready_operational_users === 2
    && state.ready_google_identity_users + state.ready_credential_identity_users === 4
    && state.ambiguous_supported_provider_users === 0
    && state.distinct_normalized_emails === 4
    && state.distinct_supported_provider_accounts === 4;
}

function assertPreflightReady(state) {
  const expected = {
    schema_present: 1,
    allowlist_total: 0,
    allowlist_active: 0,
    active_grant_rows: 34,
    super_users: 2,
    operational_users: 2,
    other_users: 0,
    candidate_users: 4,
    candidate_grant_rows: 34,
    active_identity_users: 4,
    valid_normalized_email_users: 4,
    reserved_metadata_collision_rows: 0,
    principal_linked_active_grant_rows: 0,
    adoption_marked_active_grant_rows: 0
  };
  return Object.entries(expected).every(([key, value]) => state[key] === value)
    && providerAwareIdentityReady(state);
}

function assertAdoptedState(state) {
  const expected = {
    schema_present: 1,
    allowlist_total: 4,
    allowlist_active: 4,
    allowlist_super: 2,
    allowlist_operational: 2,
    active_grant_rows: 34,
    super_users: 2,
    operational_users: 2,
    other_users: 0,
    candidate_users: 4,
    candidate_grant_rows: 34,
    active_identity_users: 4,
    valid_normalized_email_users: 4,
    principal_linked_active_grant_rows: 34,
    adoption_marked_active_grant_rows: 34
  };
  return Object.entries(expected).every(([key, value]) => state[key] === value)
    && providerAwareIdentityReady(state);
}

async function applyAdoption() {
  const rows = await sql.query(`
    with
    ${BASE_CTES},
    ready_identities as materialized (
      select
        identity_state.*,
        case
          when google_account_count = 1 and credential_account_count = 0 then 'google'
          when credential_account_count = 1 and google_account_count = 0 then 'credential'
          else null
        end as canonical_provider,
        case
          when google_account_count = 1 and credential_account_count = 0 then google_account_id
          when credential_account_count = 1 and google_account_count = 0 then credential_account_id
          else null
        end as canonical_provider_account_id
      from identity_state
      where auth_user_id is not null
        and account_status = 'active'
        and normalized_email is not null
        and char_length(normalized_email) between 3 and 254
        and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        and (
          (google_account_count = 1 and credential_account_count = 0 and google_account_id is not null and email_verified = true)
          or
          (credential_account_count = 1 and google_account_count = 0 and credential_account_id is not null)
        )
    ),
    guard as materialized (
      select 1 as ok
      where (select count(*) from padiem_admin_identity_allowlist) = 0
        and (select count(*) from active_grants) = 34
        and (select count(*) from classified where authority_role = 'admin') = 2
        and (select count(*) from classified where authority_role = 'operator') = 2
        and (select count(*) from classified where authority_role = 'other') = 0
        and (select count(*) from candidates) = 4
        and (select coalesce(sum(grant_rows), 0) from candidates) = 34
        and (select count(*) from ready_identities) = 4
        and (select count(distinct normalized_email) from ready_identities) = 4
        and not exists (
          select 1
          from candidate_grants
          where metadata ?| array['source','principalId','provider','adoptionMarker']
        )
    ),
    inserted_principals as materialized (
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
        i.canonical_provider,
        i.normalized_email,
        i.canonical_provider_account_id,
        i.authority_role,
        case
          when i.authority_role = 'admin' then array['*']::text[]
          else array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident.verification.manage','resident_news.review','safety.report.review']::text[]
        end,
        'active',
        null,
        'adopt existing verified Production administrator authority',
        jsonb_build_object(
          'source', 'legacy_admin_grant_adoption',
          'adoptionMarker', '${ADOPTION_MARKER}'
        )
      from ready_identities i
      cross join guard
      returning id, normalized_email, authority_level
    ),
    linked_grants as materialized (
      update padiem_operator_grants g
      set metadata = g.metadata || jsonb_build_object(
        'source', 'admin_identity_allowlist',
        'principalId', p.id::text,
        'provider', i.canonical_provider,
        'adoptionMarker', '${ADOPTION_MARKER}'
      )
      from ready_identities i
      join inserted_principals p
        on p.normalized_email = i.normalized_email
      cross join guard
      where g.user_id = i.user_id
        and g.status = 'active'
        and (g.expires_at is null or g.expires_at > now())
      returning g.id, g.user_id, g.scope
    ),
    asserted as materialized (
      select
        1 / case
          when (select count(*) from inserted_principals) = 4
           and (select count(*) from inserted_principals where authority_level = 'admin') = 2
           and (select count(*) from inserted_principals where authority_level = 'operator') = 2
           and (select count(*) from linked_grants) = 34
          then 1
          else 0
        end as ok
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
        'admin.principal.adopt-existing',
        'platform.authz.manage',
        'administrator-principal-set',
        null,
        'allowed',
        'ADMIN_EXISTING_PRINCIPALS_ADOPTED',
        jsonb_build_object(
          'principalCount', 4,
          'superCount', 2,
          'operationalCount', 2,
          'linkedGrantRows', 34
        )
      from asserted
      returning id
    )
    select
      (select count(*)::int from inserted_principals) as inserted_principals,
      (select count(*)::int from linked_grants) as linked_grant_rows,
      (select count(*)::int from audited) as audit_rows
  `, []);
  const row = rows[0] || {};
  return {
    inserted_principals: numeric(row.inserted_principals),
    linked_grant_rows: numeric(row.linked_grant_rows),
    audit_rows: numeric(row.audit_rows)
  };
}

async function rollbackAdoption() {
  const rows = await sql.query(`
    with
    adoption_principals as materialized (
      select id
      from padiem_admin_identity_allowlist
      where metadata ->> 'adoptionMarker' = '${ADOPTION_MARKER}'
    ),
    adoption_grants as materialized (
      select id
      from padiem_operator_grants
      where status = 'active'
        and (expires_at is null or expires_at > now())
        and metadata ->> 'adoptionMarker' = '${ADOPTION_MARKER}'
        and metadata ->> 'source' = 'admin_identity_allowlist'
        and nullif(metadata ->> 'principalId', '') is not null
    ),
    all_managed_active as materialized (
      select id
      from padiem_operator_grants
      where status = 'active'
        and (expires_at is null or expires_at > now())
        and metadata ->> 'source' = 'admin_identity_allowlist'
        and nullif(metadata ->> 'principalId', '') is not null
    ),
    guard as materialized (
      select 1 as ok
      where (select count(*) from padiem_admin_identity_allowlist) = 4
        and (select count(*) from adoption_principals) = 4
        and (select count(*) from adoption_grants) = 34
        and (select count(*) from all_managed_active) = 34
    ),
    unlinked_grants as materialized (
      update padiem_operator_grants g
      set metadata = (((g.metadata - 'source') - 'principalId') - 'provider') - 'adoptionMarker'
      from guard
      where g.id in (select id from adoption_grants)
      returning g.id
    ),
    deleted_principals as materialized (
      delete from padiem_admin_identity_allowlist p
      using guard
      where p.id in (select id from adoption_principals)
      returning p.id
    ),
    asserted as materialized (
      select
        1 / case
          when (select count(*) from unlinked_grants) = 34
           and (select count(*) from deleted_principals) = 4
          then 1
          else 0
        end as ok
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
        'admin.principal.adopt-existing.rollback',
        'platform.authz.manage',
        'administrator-principal-set',
        null,
        'recorded',
        'ADMIN_EXISTING_PRINCIPALS_ADOPTION_ROLLED_BACK',
        jsonb_build_object(
          'principalCount', 4,
          'unlinkedGrantRows', 34
        )
      from asserted
      returning id
    )
    select
      (select count(*)::int from unlinked_grants) as unlinked_grant_rows,
      (select count(*)::int from deleted_principals) as deleted_principals,
      (select count(*)::int from audited) as audit_rows
  `, []);
  const row = rows[0] || {};
  return {
    unlinked_grant_rows: numeric(row.unlinked_grant_rows),
    deleted_principals: numeric(row.deleted_principals),
    audit_rows: numeric(row.audit_rows)
  };
}

try {
  const before = await readState();
  console.log('ADMIN_PRINCIPAL_ADOPTION_PREFLIGHT=PASS');
  console.log(JSON.stringify({ mode, ...before }, null, 2));

  if (before.schema_present !== 1) {
    console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL allowlist schema missing');
    process.exit(1);
  }

  if (mode === 'preflight') {
    console.log(`ADMIN_PRINCIPAL_ADOPTION_READY=${assertPreflightReady(before) ? 'YES' : 'NO'}`);
    console.log('ADMIN_PRINCIPAL_ADOPTION_DISPOSITION=READ_ONLY');
    process.exit(0);
  }

  if (mode === 'apply') {
    if (!assertPreflightReady(before)) {
      console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL preflight state is not the exact existing-four authority shape');
      process.exit(1);
    }
    const result = await applyAdoption();
    if (result.inserted_principals !== 4 || result.linked_grant_rows !== 34 || result.audit_rows !== 1) {
      console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL atomic adoption result mismatch');
      process.exit(1);
    }
    const after = await readState();
    if (!assertAdoptedState(after)) {
      console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL post-adoption aggregate readback mismatch');
      process.exit(1);
    }
    console.log('ADMIN_PRINCIPAL_ADOPTION=PASS');
    console.log(JSON.stringify({
      inserted_principals: 4,
      linked_grant_rows: 34,
      grant_scope_status_mutation: 0,
      account_link_mutation: 0,
      ...after
    }, null, 2));
    process.exit(0);
  }

  if (!assertAdoptedState(before)) {
    console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL rollback requires the untouched adoption state');
    process.exit(1);
  }
  const result = await rollbackAdoption();
  if (result.unlinked_grant_rows !== 34 || result.deleted_principals !== 4 || result.audit_rows !== 1) {
    console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL atomic rollback result mismatch');
    process.exit(1);
  }
  const after = await readState();
  if (!assertPreflightReady(after)) {
    console.error('ADMIN_PRINCIPAL_ADOPTION=FAIL rollback readback did not restore pre-adoption state');
    process.exit(1);
  }
  console.log('ADMIN_PRINCIPAL_ADOPTION_ROLLBACK=PASS');
  console.log(JSON.stringify({
    deleted_principals: 4,
    unlinked_grant_rows: 34,
    grant_scope_status_mutation: 0,
    account_link_mutation: 0,
    ...after
  }, null, 2));
} catch (error) {
  const sqlState = error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN';
  console.error(`ADMIN_PRINCIPAL_ADOPTION=FAIL database operation failed sqlstate=${sqlState}`);
  process.exit(1);
}
