import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const app = await readFile(new URL('src/app.ts', root), 'utf8');

assert.ok(economy.includes('requireVerifiedResident(request, env, sql, requestId, input.complexSlug)'));
assert.ok(economy.includes('requireVerifiedResident(request, env, sql, requestId, complexSlug)'));
assert.ok(!economy.includes('complex_memberships'));
assert.ok(economy.includes("path === '/api/v1/me/business-applications'"));
assert.ok(economy.includes('/benefits\\/([0-9a-fA-F-]+)\\/claim'));
assert.ok(economy.includes('${resident.complexId}::uuid'));
assert.ok(economy.includes('${resident.id}::uuid'));
assert.ok(economy.includes('on conflict (applicant_user_id, submission_key)'));
assert.ok(economy.includes('on conflict (user_id, benefit_id) do nothing'));

const v2 = app.indexOf('handleResidentEconomyMutationRequest(request, env, id)');
const wallet = app.indexOf('handleBenefitWalletRequest(request, env, id)');
const application = app.indexOf('handleResidentApplicationRequest(request, env, id)');
assert.ok(v2 >= 0 && wallet > v2 && application > v2);

console.log('PASS resident economy Household v2 contract');
