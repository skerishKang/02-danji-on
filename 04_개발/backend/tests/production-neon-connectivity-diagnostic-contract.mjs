import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/production-neon-connectivity-diagnostic.yml', import.meta.url), 'utf8');

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
assert.match(workflow, /environment:\s*production/);
assert.match(workflow, /expected_main:/);
assert.match(workflow, /DANJION_PRODUCTION_DB_URL:\s*\$\{\{ secrets\.DANJION_PRODUCTION_DB_URL \}\}/);
assert.match(workflow, /Exact main authority guard/);
assert.match(workflow, /dns\.lookup/);
assert.match(workflow, /net\.createConnection/);
assert.match(workflow, /select 1::int as ok/);
assert.match(workflow, /DNS_RESOLUTION=PASS/);
assert.match(workflow, /TCP_REACHABILITY=PASS/);
assert.match(workflow, /SQL_READONLY_SELECT=PASS/);
assert.doesNotMatch(workflow, /console\.log\([^\n]*(host|raw|parsed|resolved)/i);
assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret)/i);
assert.doesNotMatch(workflow, /\b(insert|update|delete|alter|drop|create table|truncate|grant|revoke)\b/i);
assert.match(workflow, /PRODUCTION_MUTATION=0/);
assert.match(workflow, /DB_MUTATION=0/);
assert.match(workflow, /SECRET_OUTPUT=0/);

console.log('production Neon connectivity diagnostic contract: PASS');
