import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/production-readonly-diagnostic.yml', 'utf8');
const script = readFileSync('04_개발/backend/scripts/production-readonly-diagnostic.mjs', 'utf8');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(workflow.includes('environment: production'), 'PRODUCTION_ENV_MISSING');
assert(workflow.includes('expected_main'), 'EXACT_MAIN_GUARD_MISSING');
assert(script.includes('ACCOUNT_PROVISIONING=NO'), 'ACCOUNT_GUARD_MISSING');
assert(script.includes('HOUSEHOLD_MUTATION=NO'), 'HOUSEHOLD_GUARD_MISSING');
assert(script.includes('MEMBERSHIP_MUTATION=NO'), 'MEMBERSHIP_GUARD_MISSING');
assert(!script.includes('INSERT') && !script.includes('UPDATE'), 'MUTATION_TOKEN_FOUND');

console.log('PRODUCTION_READONLY_DIAGNOSTIC_CONTRACT=PASS');
