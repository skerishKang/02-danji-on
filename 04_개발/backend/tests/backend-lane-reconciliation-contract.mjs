import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [app, economy, community, moderation, schema] = await Promise.all([
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/resident-economy-v2.ts', root), 'utf8'),
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/community-moderation-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/013_community_core.sql', root), 'utf8')
]);

for (const handler of [
  'handleCommunityResidentRequest',
  'handleCommunityModerationRequest',
  'handleResidentEconomyMutationRequest',
  'handleAccountLifecycleRequest',
  'handleHouseholdFamilyRequest'
]) {
  assert.ok(app.includes(handler), `missing reconciled handler ${handler}`);
}

const economyIndex = app.indexOf('const residentEconomyResponse = await handleResidentEconomyMutationRequest');
const walletIndex = app.indexOf('const benefitWalletResponse = await handleBenefitWalletRequest');
const applicationIndex = app.indexOf('const residentApplicationResponse = await handleResidentApplicationRequest');
assert.ok(economyIndex >= 0 && walletIndex > economyIndex && applicationIndex > economyIndex,
  'Household-v2 resident-economy interception must run before legacy mutation handlers');

assert.match(economy, /requireVerifiedResident\(/);
assert.doesNotMatch(economy, /complex_memberships/, 'reconciled resident-economy mutations must not use legacy membership authority');
assert.match(community, /requireVerifiedResident\(/);
assert.doesNotMatch(community, /complex_memberships/, 'resident Community must use Household-v2 resident authority');
assert.match(moderation, /requireOperationalAuthority\(/);
assert.ok(moderation.includes("'community.moderate'"));
assert.ok(moderation.includes("'council.community.moderate'"));
assert.doesNotMatch(moderation, /complex_memberships/);
assert.doesNotMatch(moderation, /onboarding_support/);

for (const table of [
  'community_posts',
  'community_comments',
  'community_reactions',
  'community_reports',
  'community_moderation_events'
]) {
  assert.ok(schema.includes(table), `missing Community C2 schema table ${table}`);
}

assert.ok(app.indexOf('handleCommunityModerationRequest') < app.indexOf("pathname.startsWith('/api/v1/admin/')"),
  'Community operator route must be resolved before generic fallback processing');

console.log('PASS design-independent backend lane reconciliation contract');
