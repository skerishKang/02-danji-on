import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/production-readonly-diagnostic.yml', import.meta.url), 'utf8');
const script = await readFile(new URL('../scripts/production-readonly-diagnostic.mjs', import.meta.url), 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(workflow.includes('environment: production'), 'PRODUCTION_ENV_MISSING');
assert(workflow.includes('expected_main'), 'EXACT_MAIN_GUARD_MISSING');
assert(workflow.includes('workflow_dispatch'), 'DISPATCH_GUARD_MISSING');
assert(script.includes('ACCOUNT_PROVISIONING=NO'), 'ACCOUNT_GUARD_MISSING');
assert(script.includes('HOUSEHOLD_MUTATION=NO'), 'HOUSEHOLD_GUARD_MISSING');
assert(script.includes('MEMBERSHIP_MUTATION=NO'), 'MEMBERSHIP_GUARD_MISSING');
assert(script.includes('SIGNUP_FLOW=NOT_USED'), 'SIGNUP_GUARD_MISSING');
assert(script.includes('PROVISION_FLOW=NOT_USED'), 'PROVISION_GUARD_MISSING');
assert(!script.includes('INSERT') && !script.includes('UPDATE'), 'MUTATION_TOKEN_FOUND');

console.log('PRODUCTION_READONLY_DIAGNOSTIC_CONTRACT=PASS');
