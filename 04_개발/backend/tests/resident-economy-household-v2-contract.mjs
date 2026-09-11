import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const economy = await readFile(new URL('src/resident-economy-v2.ts', root), 'utf8');
const claim = await readFile(new URL('src/benefit-claim-v1.ts', root), 'utf8');
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
assert.ok(claim.includes('/benefits\\/([0-9a-fA-F-]+)\\/claim'));
assert.ok(economy.includes('${resident.complexId}::uuid'));
assert.ok(economy.includes('${resident.id}::uuid'));
assert.ok(economy.includes('on conflict (applicant_user_id, submission_key)'));
assert.ok(claim.includes('on conflict (user_id, benefit_id) do nothing'));

// D3-A: claim mutation authority lives exclusively in benefit-claim-v1.
assert.ok(claim.includes('requireVerifiedResident(request, env, sql, requestId, complexSlug)'));
assert.ok(claim.includes('${resident.id}::uuid'));
assert.ok(claim.includes('${resident.complexId}::uuid'));
assert.ok(claim.includes("'DANJION-' || upper"));
assert.equal(economy.includes('insert into benefit_claims'), false,
  'claim persistence must not remain in resident-economy-v2');
assert.equal(economy.includes("'DANJION-' || upper"), false,
  'claim code generation must not remain in resident-economy-v2');

// Sibling final v3 owner-registration bridge depends on these canonical fields.
for (const field of [
  'id', 'relation_type', 'business_name', 'category_name', 'service_summary',
  'price_text', 'contact_method', 'service_area', 'benefit_text',
  'availability_text', 'representative_image_object_key', 'status',
  'review_note', 'approved_business_id', 'submission_key', 'created_at', 'updated_at'
]) {
  assert.ok(economy.includes(field), `owner application persistence must retain ${field}`);
}
// GAP-4: create responses now carry the additive photoObjectKeys gallery
// alongside the persisted row, replay marker, and HTTP 201.
assert.ok(economy.includes('idempotency_replayed: false }, galleryKeys)') || economy.includes('idempotency_replayed: false }'),
  'new owner application must return the persisted row, replay marker, and HTTP 201');
assert.ok(economy.includes('requestId, 201)'),
  'new owner application must return HTTP 201');
assert.ok(economy.includes('photoObjectKeys'),
  'owner application responses must carry the additive photo gallery contract');
assert.match(economy, /idempotency_replayed: true/,
  'owner application idempotent replay must be explicit');
assert.match(economy, /Only changes_requested applications can be resubmitted/,
  'owner application resubmit must remain changes_requested-only');
assert.equal(economy.includes('/shop-recommendations'), false,
  'owner application mutation authority must not absorb non-owner report/recommendation routes');

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
// benefit-claim-v1 and must not retain legacy verification authority.
assert.ok(legacyWallet.includes("request.method === 'GET'"));
assert.ok(legacyWallet.includes("request.method === 'PATCH'"));
assert.ok(legacyWallet.includes('/benefits\\/([0-9a-fA-F-]+)\\/use'));
assert.equal(legacyWallet.includes('/benefits\\/([0-9a-fA-F-]+)\\/claim'), false);
assert.equal(legacyWallet.includes('complex_memberships'), false);
assert.equal(legacyWallet.includes('requireVerifiedMembership'), false);
assert.equal(legacyWallet.includes('insert into benefit_claims'), false);

// Core remains the collection-read fallback only. Business-contact disclosure
// must use current Household-v2 verified-resident authority and must never
// revive legacy complex_memberships manager/admin privilege as an access path.
assert.ok(core.includes("request.method === 'GET' && path === '/api/v1/me/business-applications'"));
assert.equal(core.includes("request.method === 'POST' && path === '/api/v1/me/business-applications'"), false);
assert.equal(core.includes('insert into business_applications'), false);
assert.ok(core.includes("import { requireVerifiedResident } from './authorization-v2';"));
assert.ok(core.includes('requireVerifiedResident(request, env, sql, id, complexSlug)'));
assert.ok(core.includes("bc.visibility in ('public','verified_residents')"));
assert.equal(core.includes('async function membership('), false);
assert.equal(core.includes("['manager','admin']"), false);
assert.equal(core.includes('No membership for target complex'), false);

// Routing order remains defense in depth even though legacy mutation ownership
// is now removed from the lower handlers themselves.
const v2 = app.indexOf('handleResidentEconomyMutationRequest(request, env, id)');
const claimRoute = app.indexOf('handleBenefitClaimRequest(request, env, id)');
const wallet = app.indexOf('handleBenefitWalletRequest(request, env, id)');
const application = app.indexOf('handleResidentApplicationRequest(request, env, id)');
const coreFallback = app.indexOf('return respond(await core.fetch(request, env))');
assert.ok(v2 >= 0 && claimRoute > v2 && wallet > claimRoute && application > v2 && coreFallback > application);

console.log('PASS resident economy Household v2 sole-mutation-authority and business-contact authz contract');
