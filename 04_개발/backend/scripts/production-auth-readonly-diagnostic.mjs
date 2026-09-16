import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl) {
  console.error('DANJION_AUTH_READONLY_DIAG=FAIL missing production database URL');
  process.exit(1);
}

const forbidden = /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|merge|call|copy|vacuum|analyze|comment|refresh|reindex|cluster)\b/i;
const OPERATIONAL_PRESET = [
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident_news.review',
  'safety.report.review'
];

const LEGACY_OPERATIONAL_SCOPES = [
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident_news.review',
  'safety.report.review'
];

const queries = [
  {
    key: 'recent_google_accounts',
    fields: ['count', 'newest_hour'],
    sql: `
      select count(*)::int as count,
             date_trunc('hour', max(created_at)) as newest_hour
      from danjion_auth.account
      where provider_id = 'google'
        and created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'recent_users',
    fields: ['count', 'newest_hour'],
    sql: `
      select count(*)::int as count,
             date_trunc('hour', max(created_at)) as newest_hour
      from danjion_auth."user"
      where created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'recent_sessions',
    fields: ['count', 'newest_hour'],
    sql: `
      select count(*)::int as count,
             date_trunc('hour', max(created_at)) as newest_hour
      from danjion_auth.session
      where created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'active_google_linked_sessions',
    fields: ['count', 'newest_hour'],
    sql: `
      select count(distinct s.id)::int as count,
             date_trunc('hour', max(s.created_at)) as newest_hour
      from danjion_auth.session s
      join danjion_auth.account a on a.user_id = s.user_id
      where a.provider_id = 'google'
        and s.expires_at > now()
        and s.created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'admin_allowlist_schema',
    fields: ['present'],
    sql: `
      select (to_regclass('public.padiem_admin_identity_allowlist') is not null)::int as present
    `
  },
  {
    key: 'admin_principal_status',
    fields: ['active', 'revoked', 'expired'],
    sql: `
      select
        count(*) filter (
          where status = 'active'
            and (expires_at is null or expires_at > now())
        )::int as active,
        count(*) filter (where status = 'revoked')::int as revoked,
        count(*) filter (
          where status = 'expired'
             or (status = 'active' and expires_at is not null and expires_at <= now())
        )::int as expired
      from padiem_admin_identity_allowlist
    `
  },
  {
    key: 'admin_principal_authority',
    fields: ['super', 'operational', 'other', 'google_active'],
    sql: `
      select
        count(*) filter (
          where status = 'active'
            and (expires_at is null or expires_at > now())
            and authority_level = 'admin'
            and scopes = array['*']::text[]
        )::int as super,
        count(*) filter (
          where status = 'active'
            and (expires_at is null or expires_at > now())
            and authority_level = 'operator'
            and array_position(scopes, '*') is null
            and cardinality(scopes) = 8
            and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
            and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
        )::int as operational,
        count(*) filter (
          where status = 'active'
            and (expires_at is null or expires_at > now())
            and not (
              (authority_level = 'admin' and scopes = array['*']::text[])
              or
              (
                authority_level = 'operator'
                and array_position(scopes, '*') is null
                and cardinality(scopes) = 8
                and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
                and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
              )
            )
        )::int as other,
        count(*) filter (
          where status = 'active'
            and (expires_at is null or expires_at > now())
            and provider = 'google'
        )::int as google_active
      from padiem_admin_identity_allowlist
    `
  },
  {
    key: 'admin_duplicate_active_google_identity_groups',
    fields: ['count'],
    sql: `
      select count(*)::int as count
      from (
        select normalized_email
        from padiem_admin_identity_allowlist
        where provider = 'google'
          and status = 'active'
          and (expires_at is null or expires_at > now())
        group by normalized_email
        having count(*) > 1
      ) duplicate_groups
    `
  },
  {
    key: 'admin_bootstrap_runtime_authority',
    fields: ['super_users', 'operational_users', 'other_users', 'active_grant_rows'],
    sql: `
      with active_bootstrap_grants as (
        select g.user_id, g.scope
        from padiem_operator_grants g
        where g.status = 'active'
          and (g.expires_at is null or g.expires_at > now())
          and g.metadata ->> 'source' = 'admin_identity_allowlist'
      ),
      by_user as (
        select
          user_id,
          array_agg(distinct scope order by scope) as scopes
        from active_bootstrap_grants
        group by user_id
      )
      select
        count(*) filter (
          where cardinality(scopes) = 9
            and scopes @> array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
            and array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
        )::int as super_users,
        count(*) filter (
          where array_position(scopes, '*') is null
            and cardinality(scopes) = 8
            and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
            and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
        )::int as operational_users,
        count(*) filter (
          where not (
            (
              cardinality(scopes) = 9
              and scopes @> array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
              and array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
            )
            or
            (
              array_position(scopes, '*') is null
              and cardinality(scopes) = 8
              and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
              and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
            )
          )
        )::int as other_users,
        (select count(*)::int from active_bootstrap_grants) as active_grant_rows
      from by_user
    `
  },
  {
    key: 'all_source_runtime_authority',
    fields: ['legacy_super_users', 'legacy_operational_users', 'other_users', 'active_grant_rows'],
    sql: `
      with active_all_grants as (
        select g.user_id, g.scope
        from padiem_operator_grants g
        where g.status = 'active'
          and (g.expires_at is null or g.expires_at > now())
      ),
      by_user as (
        select
          user_id,
          array_agg(distinct scope order by scope) as scopes
        from active_all_grants
        group by user_id
      )
      select
        count(*) filter (
          where cardinality(scopes) = 9
            and scopes @> array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
            and array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
        )::int as legacy_super_users,
        count(*) filter (
          where cardinality(scopes) = 8
            and array_position(scopes, '*') is null
            and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
            and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
        )::int as legacy_operational_users,
        count(*) filter (
          where not (
            (
              cardinality(scopes) = 9
              and scopes @> array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
              and array['*','benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
            )
            or
            (
              cardinality(scopes) = 8
              and array_position(scopes, '*') is null
              and scopes @> array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[]
              and array['benefit.manage','business.review','community.moderate','inquiry.respond','official-content.manage','resident.verification.exempt','resident_news.review','safety.report.review']::text[] @> scopes
            )
          )
        )::int as other_users,
        (select count(*)::int from active_all_grants) as active_grant_rows
      from by_user
    `
  }
];

for (const query of queries) {
  if (!/^\s*(select|with)\b/i.test(query.sql) || forbidden.test(query.sql)) {
    console.error(`DANJION_AUTH_READONLY_DIAG=FAIL unsafe query contract: ${query.key}`);
    process.exit(1);
  }
}

function safeValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== '') return numeric;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  throw new Error('readonly diagnostic received an unexpected non-aggregate value');
}

const sql = neon(dbUrl);
const output = {};
for (const query of queries) {
  const rows = await sql.query(query.sql, []);
  const row = rows[0] || {};
  output[query.key] = Object.fromEntries(
    query.fields.map((field) => [field, safeValue(row[field])])
  );
}

console.log('DANJION_AUTH_READONLY_DIAG=PASS');
console.log(JSON.stringify({
  window_hours: 24,
  admin_operational_preset_scope_count: OPERATIONAL_PRESET.length,
  legacy_operational_scope_count: LEGACY_OPERATIONAL_SCOPES.length,
  ...output
}, null, 2));
