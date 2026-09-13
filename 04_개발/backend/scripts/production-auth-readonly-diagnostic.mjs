import { neon } from '@neondatabase/serverless';

const dbUrl = process.env.DANJION_PRODUCTION_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl) {
  console.error('DANJION_AUTH_READONLY_DIAG=FAIL missing production database URL');
  process.exit(1);
}

const forbidden = /\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|merge|call|copy|vacuum|analyze|comment|refresh|reindex|cluster)\b/i;
const queries = [
  {
    key: 'recent_google_accounts',
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
    sql: `
      select count(*)::int as count,
             date_trunc('hour', max(created_at)) as newest_hour
      from danjion_auth."user"
      where created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'recent_sessions',
    sql: `
      select count(*)::int as count,
             date_trunc('hour', max(created_at)) as newest_hour
      from danjion_auth.session
      where created_at >= now() - interval '24 hours'
    `
  },
  {
    key: 'active_google_linked_sessions',
    sql: `
      select count(distinct s.id)::int as count,
             date_trunc('hour', max(s.created_at)) as newest_hour
      from danjion_auth.session s
      join danjion_auth.account a on a.user_id = s.user_id
      where a.provider_id = 'google'
        and s.expires_at > now()
        and s.created_at >= now() - interval '24 hours'
    `
  }
];

for (const query of queries) {
  if (!/^\s*select\b/i.test(query.sql) || forbidden.test(query.sql)) {
    console.error(`DANJION_AUTH_READONLY_DIAG=FAIL unsafe query contract: ${query.key}`);
    process.exit(1);
  }
}

const sql = neon(dbUrl);
const output = {};
for (const query of queries) {
  const rows = await sql.query(query.sql, []);
  const row = rows[0] || {};
  output[query.key] = {
    count: Number(row.count || 0),
    newest_hour: row.newest_hour ? new Date(row.newest_hour).toISOString() : null
  };
}

console.log('DANJION_AUTH_READONLY_DIAG=PASS');
console.log(JSON.stringify({
  window_hours: 24,
  ...output
}, null, 2));
