import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/production-auth-readonly-diagnostic.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-auth-readonly-diagnostic.mjs', import.meta.url), 'utf8');

assert.match(workflow, /workflow_dispatch:/, 'diagnostic must be manual dispatch only');
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m, 'diagnostic must not auto-run');
assert.match(workflow, /environment:\s*production/, 'diagnostic must use production environment');
assert.match(workflow, /expected_main:/, 'diagnostic must require exact main input');
assert.match(workflow, /DANJION_PRODUCTION_DB_URL:\s*\$\{\{ secrets\.DANJION_PRODUCTION_DB_URL \}\}/,
  'diagnostic must consume production DB secret without exposing its value');
assert.match(workflow, /Exact main authority guard/, 'workflow must exact-main guard');
assert.match(workflow, /production-auth-readonly-diagnostic\.mjs/, 'workflow must run the readonly diagnostic script');
assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret)/i, 'diagnostic must not deploy or touch worker secrets');
assert.doesNotMatch(workflow, /production-migration-gate|migration.*apply|psql.*-[cfa]/i,
  'diagnostic must not invoke migration/apply paths');

assert.match(script, /from danjion_auth\.account/, 'script must inspect Better Auth account aggregates');
assert.match(script, /from danjion_auth\."user"/, 'script must inspect Better Auth user aggregates');
assert.match(script, /from danjion_auth\.session/, 'script must inspect Better Auth session aggregates');
assert.match(script, /provider_id\s*=\s*'google'/, 'script must scope provider aggregate to Google');
assert.match(script, /count\(distinct s\.id\)/, 'script must count linked active sessions without identity output');
assert.match(script, /date_trunc\('hour'/, 'timestamps must be coarse-grained');
assert.match(script, /forbidden\s*=.*insert.*update.*delete.*alter.*drop/is,
  'script must fail closed on mutation/DDL keywords');
assert.match(script, /!\/\^\\s\*select\\b\/i\.test\(query\.sql\)/,
  'every query must be SELECT-only');
assert.doesNotMatch(script, /email|account_id|session\.token|ip_address|user_agent|access_token|refresh_token|id_token/i,
  'diagnostic source must not select or print identity/token fields');

console.log('production auth readonly diagnostic contract: PASS');
