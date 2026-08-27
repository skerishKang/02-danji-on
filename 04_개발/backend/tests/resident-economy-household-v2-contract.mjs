import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const app = await readFile(new URL('src/app.ts', root), 'utf8');
const legacyApplication = await readFile(new URL('src/resident-application-v1.ts', root), 'utf8');
const legacyWallet = await readFile(new URL('src/benefit-wallet-v1.ts', root), 'utf8');
const core = await readFile(new URL('src/core-v1.ts', root), 'utf8');

// Current Household-v2 mutation authority.
assert.ok(economy.includes('requireVerifiedResident(request, env, sql, requestId, input.complexSlug)'));
assert.ok(economy.includes('requireVerifiedResident(request, env, sql, requestId, complexSlug)'));
assert.ok(!economy.includes('complex_memberships'));
assert.ok(economy.includes("path === '/api/v1/me/business-applications'"));
assert.ok(economy.includes("request.method === 'PATCH'"));
assert.ok(economy.includes('/business-applications\\/([0-9a-fA-F-]+)'));
assert.ok(economy.includes('/benefits\\/([0-9a-fA-F-]+)\\/claim'));
assert.ok(economy.includes('${resident.complexId}::uuid'));
assert.ok(economy.includes('${resident.id}::uuid'));
assert.ok(economy.includes('on conflict (applicant_user_id, submission_key)'));
assert.ok(economy.includes('on conflict (user_id, benefit_id) do nothing'));

// Legacy application handler is read-only detail ownership now. It must never
// become a dormant alternate create/resubmit authority again.
assert.ok(legacyApplication.includes("request.method === 'GET'"));
assert.ok(legacyApplication.includes('/business-applications\\/([0-9a-fA-F-]+)'));
assert.equal(legacyApplication.includes("request.method === 'POST'"), false);
assert.equal(legacyApplication.includes("request.method === 'PATCH'"), false);
assert.equal(legacyApplication.includes('complex_memberships'), false);
assert.equal(legacyApplication.includes('insert into business_applications'), false);
assert.equal(legacyApplication.includes('update business_applications'), false);

// Legacy wallet keeps actor-owned list/use only. Claim belongs exclusively to
// resident-economy-v2 and must not retain legacy verification authority.
assert.ok(legacyWallet.includes("request.method === 'GET'"));
assert.ok(legacyWallet.includes("request.method === 'PATCH'"));
assert.ok(legacyWallet.includes('/benefits\\/([0-9a-fA-F-]+)\\/use'));
assert.equal(legacyWallet.includes('/benefits\\/([0-9a-fA-F-]+)\\/claim'), false);
assert.equal(legacyWallet.includes('complex_memberships'), false);
assert.equal(legacyWallet.includes('requireVerifiedMembership'), false);
assert.equal(legacyWallet.includes('insert into benefit_claims'), false);

// Core remains the collection-read fallback only. It may still use historical
// membership data for unrelated self-profile/contact compatibility, but it may
// never own the business-application create mutation again.
assert.ok(core.includes("request.method === 'GET' && path === '/api/v1/me/business-applications'"));
assert.equal(core.includes("request.method === 'POST' && path === '/api/v1/me/business-applications'"), false);
assert.equal(core.includes('insert into business_applications'), false);

// Routing order remains defense in depth even though legacy mutation ownership
// is now removed from the lower handlers themselves.
const v2 = app.indexOf('handleResidentEconomyMutationRequest(request, env, id)');
const wallet = app.indexOf('handleBenefitWalletRequest(request, env, id)');
const application = app.indexOf('handleResidentApplicationRequest(request, env, id)');
const coreFallback = app.indexOf('return respond(await core.fetch(request, env))');
assert.ok(v2 >= 0 && wallet > v2 && application > v2 && coreFallback > application);

console.log('PASS resident economy Household v2 sole-mutation-authority contract');
