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
assert.match(script, /!\/\^\\s\*\(select\|with\)\\b\/i\.test\(query\.sql\)/,
  'every query must be a read-only SELECT/CTE');
assert.match(script, /to_regclass\('public\.padiem_admin_identity_allowlist'\)/,
  'diagnostic must verify the admin allowlist schema is present');
assert.match(script, /from padiem_admin_identity_allowlist/,
  'diagnostic must inspect admin principal aggregates');
assert.match(script, /from padiem_operator_grants g/,
  'diagnostic must inspect runtime PADIEM grant aggregates');
assert.match(script, /g\.metadata ->> 'source' = 'admin_identity_allowlist'/,
  'bootstrap runtime aggregate must remain scoped to allowlist-origin grants');
assert.match(script, /key: 'all_source_runtime_authority'/,
  'diagnostic must separately inspect all-source active runtime authority');
assert.match(script, /const OPERATIONAL_PRESET = \[[\s\S]*resident\.verification\.exempt[\s\S]*resident\.verification\.manage[\s\S]*safety\.report\.review/,
  'current operational preset must include the bounded household-code management scope');
assert.match(script, /const LEGACY_OPERATIONAL_SCOPES = \[[\s\S]*resident\.verification\.exempt[\s\S]*resident_news\.review[\s\S]*safety\.report\.review/,
  'diagnostic must retain the previous eight-scope shape for drift classification');
assert.match(script, /key: 'admin_bootstrap_runtime_authority'[\s\S]*super_current_users[\s\S]*super_legacy_users[\s\S]*operational_current_users[\s\S]*operational_legacy_users/,
  'runtime diagnostic must distinguish current 10\/9 shapes from legacy 9\/8 shapes');
assert.match(script, /cardinality\(scopes\)=10[\s\S]*CURRENT_SUPER_SQL/,
  'current SUPER runtime shape must be wildcard plus nine bounded scopes');
assert.match(script, /cardinality\(scopes\)=9[\s\S]*array_position\(scopes,'\*'\) is null[\s\S]*CURRENT_OPERATIONAL_SQL/,
  'current OPERATIONAL runtime shape must be nine bounded scopes without wildcard');
assert.match(script, /key: 'household_code_schema'[\s\S]*household_verification_codes[\s\S]*household_verification_code_events/,
  '#746 read-only preflight must report migration-050 schema presence without reading resident rows');
assert.match(script, /key: 'all_source_runtime_authority'[\s\S]*active_all_grants[\s\S]*from padiem_operator_grants g[\s\S]*g\.status = 'active'/,
  'all-source aggregate must count all active PADIEM grants regardless metadata source');
assert.match(script, /group by normalized_email[\s\S]*having count\(\*\) > 1/,
  'duplicate identity detection must aggregate by normalized email without returning the identity');
assert.match(script, /safeValue[\s\S]*unexpected non-aggregate value/,
  'diagnostic must refuse to print unexpected string/identity values');
assert.doesNotMatch(script, /fields:\s*\[[^\]]*(normalized_email|provider_account_id|user_id|grant_id|metadata)/i,
  'diagnostic output field allowlists must not expose administrator identities or metadata');
assert.doesNotMatch(script, /session\.token|ip_address|user_agent|access_token|refresh_token|id_token/i,
  'diagnostic must not select or print auth token/session metadata');

console.log('production auth readonly diagnostic contract: PASS');
