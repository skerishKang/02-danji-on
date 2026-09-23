import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Admin resident-verification exemption — server household boundary.
//
// `resident.verification.exempt` bypasses RESIDENT VERIFICATION only. It is never
// a household: it must not synthesize a householdId/membershipId/membershipRole,
// and every surface whose essence is a real household must keep enforcing real
// household membership.
//
// This contract is the regression proof for the exemption/household seam. It
// pins three facts against the canonical sources:
//
//   1. The exemption admits a principal with null household fields and carries a
//      discriminator (residentVerificationExempt) so consumers can tell the two
//      admission paths apart.
//   2. Household-specific surfaces resolve their scope from household_memberships
//      keyed on the real actor id — never from the exemption flag or the injected
//      household fields — so an exempt principal with no membership is still
//      excluded. Household messaging/targeting in particular enforces an `exists`
//      membership predicate inside the SQL feed function.
//   3. The household message bridge/handlers know nothing about the exemption.
//
// Run: node tests/resident-verification-exempt-household-boundary-contract.mjs

const root = new URL('../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

const [
  authorization,
  summary,
  blocks,
  messages,
  profile,
  safety,
  residentHouseholdMessages,
  adminHouseholdMessaging,
  householdFamily,
  householdMessagesMigration
] = await Promise.all([
  read('src/authorization-v2.ts'),
  read('src/resident-summary-v1.ts'),
  read('src/resident-blocks-v1.ts'),
  read('src/resident-messages-v1.ts'),
  read('src/resident-profile-v1.ts'),
  read('src/resident-safety-reports-v1.ts'),
  read('src/resident-household-messages-v1.ts'),
  read('src/admin-household-messaging-v1.ts'),
  read('src/household-family-v2.ts'),
  read('migrations/051_household_messages.sql')
]);

/* ==== 1. the exemption admits without a household and says so explicitly ==== */
{
  const exemptScope = "const RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident.verification.exempt'";
  assert.ok(authorization.includes(exemptScope),
    'the exemption must key on the exact canonical scope and nothing else');
  assert.ok(/residentVerificationExempt:\s*true,[\s\S]*residentVerificationExemptionSource,[\s\S]*householdId:\s*null,\s*membershipId:\s*null,\s*membershipRole:\s*null/.test(
    authorization.replace(/\s+/g, ' ')
  ), 'the exempt admission must return null household fields and an explicit exemption source (never invented ids)');
  assert.ok(/residentVerificationExempt:\s*false/.test(authorization),
    'the ordinary admission must be explicitly distinguishable from the exemption');
  // The exemption must never mint a household identity anywhere in the module.
  assert.doesNotMatch(authorization, /householdId:\s*['"`][^'"`]+['"`]/,
    'the authorization module must never synthesize a householdId literal');
}

/* ==== 2. household-specific surfaces resolve scope from real membership ==== */
{
  // Each household-specific surface must contain its own membership `exists`
  // predicate tied to the verified/active household lifecycle, keyed on the real
  // actor id. None of them may key off the exemption flag.
  const householdConsumers = {
    'resident-blocks-v1.ts': blocks,
    'resident-messages-v1.ts': messages,
    'resident-profile-v1.ts': profile,
    'resident-safety-reports-v1.ts': safety
  };
  for (const [name, source] of Object.entries(householdConsumers)) {
    // The join may be written as a FROM target or an inline JOIN — either shape
    // must still resolve household scope from household_memberships.
    assert.match(source, /(from|join) household_memberships hm/,
      `${name} must resolve its household scope from household_memberships`);
    assert.match(source, /hm\.status = 'verified'/,
      `${name} must require a verified membership, not the exemption`);
    assert.match(source, /h\.status = 'active'/,
      `${name} must require an active household row`);
    assert.match(source, /cu\.status = 'active'/,
      `${name} must require an active complex unit row`);
    // No household surface may key a household query on the real actor's own
    // household/membership fields; membership is always resolved by joining.
    assert.ok(!/resident\.householdId|actor\.householdId|resident\.membershipId|actor\.membershipId|resident\.membershipRole|actor\.membershipRole/.test(source),
      `${name} must never consume injected household/membership fields as if they were a real household`);
  }
}

/* ==== 2b. the profile module may SELECT the exemption, never a household ==== */
{
  // `resident-profile-v1.ts` is the one household-adjacent module that legitimately
  // reads the exemption scope: the OWN-account path (reached only after the
  // verified-resident gate has already returned 403) uses it to choose the
  // self-facing `operator` label. That is a label, not a household. The invariant
  // is therefore precise, not a blanket ban:
  //
  //   (a) the exempt branch must yield `complexId: null`, which routes
  //       loadOwnProfile() to loadOwnAccountProfile() — a query with NO household
  //       join and no complex scope, so no household data can be read;
  //   (b) the exempt lookup must happen strictly AFTER the 403 from the verified
  //       resident gate, so an exempt principal can never widen the shared path;
  //   (c) the exemption must never appear inside a function that joins
  //       household_memberships.
  assert.match(profile, /authority\.scopes\.includes\(RESIDENT_VERIFICATION_EXEMPT_SCOPE\)/,
    'the profile exemption must be decided from the canonical scope, not a role guess');
  assert.match(profile, /complexId: null, profileLabel: OPERATOR_PROFILE_LABEL/,
    'the exempt profile branch must drop complex scope so it cannot read household data');
  assert.match(profile, /return viewer\.complexId\s*\?\s*loadPublicProfile\(/,
    'loadOwnProfile must only reach the household-scoped public profile when complexId is present');
  assert.match(profile, /loadOwnAccountProfile/,
    'the exemption must resolve to the household-free own-account profile');
  assert.ok(!/household_memberships/.test(
    profile.slice(
      profile.indexOf('async function loadOwnAccountProfile'),
      profile.indexOf('function presentProfile')
    )
  ), 'the own-account profile query must contain no household join at all');

  // (b) the exempt branch is a fallback for a 403 only.
  const ownViewer = profile.slice(
    profile.indexOf('async function viewerForOwnProfile'),
    profile.indexOf('async function loadOwnProfile')
  );
  assert.match(ownViewer, /if \(resident\.status !== 403\) return resident;/,
    'the own-profile exemption must never pre-empt a non-403 gate outcome');
  assert.ok(
    ownViewer.indexOf('RESIDENT_VERIFICATION_EXEMPT_SCOPE') > ownViewer.indexOf('resident.status !== 403'),
    'the exemption must be consulted only after the verified-resident gate has refused'
  );

  // (c) no single function may pair the exemption with a household join.
  const fns = profile.split(/\nasync function |\nfunction /).slice(1);
  const laundering = fns.filter((body) =>
    /RESIDENT_VERIFICATION_EXEMPT_SCOPE|residentVerificationExempt/.test(body) &&
    /household_memberships/.test(body)
  );
  assert.equal(laundering.length, 0,
    'no function may derive the exemption and a household membership together');
}
{
  assert.match(summary, /resident\.residentVerificationExempt/,
    'the summary must branch on the exemption flag so it never claims a verified household');
  assert.match(summary, /status: 'exempt', membershipRole: null/,
    'the exempt branch must report exempt + null role, never a verified household');
  const verifiedEmissions = (summary.match(/status:\s*'verified'/g) || []).length;
  assert.equal(verifiedEmissions, 1,
    'exactly one verified-household emission may exist (the ordinary resident branch)');
}

/* ==== 4. household messaging: the membership predicate lives in SQL ==== */
{
  // The resident feed is the canonical household-only read: it must require a
  // verified membership inside the function, so no caller (exempt or not) can
  // widen it by supplying different actor fields.
  assert.match(householdMessagesMigration, /create or replace function resident_household_message_feed/i,
    'the canonical household feed function must exist');
  assert.match(householdMessagesMigration, /where d\.user_id = p_user_id/i,
    'deliveries must be scoped to the real actor id');
  const feedFn = householdMessagesMigration.slice(
    householdMessagesMigration.indexOf('create or replace function resident_household_message_feed')
  ).slice(0, 2000);
  assert.match(feedFn, /exists \(\s*select 1\s*from household_memberships hm/,
    'the feed must require an existing household membership (the real household boundary)');
  assert.match(feedFn, /hm\.status = 'verified'/,
    'the feed must require a verified membership');
  assert.match(feedFn, /and hm\.status = 'verified'\s*\n\s*and h\.status = 'active'\s*\n\s*and cu\.status = 'active'/,
    'the verified-membership requirement must be a closed conjunct chain');
  // The membership predicate itself must be pure conjunction: no OR relaxation may
  // widen it back open. (The outer query may legitimately use OR for the optional
  // p_message_id filter, so scope this to the `exists (...)` membership block.)
  const membershipBlock = feedFn.slice(
    feedFn.indexOf('exists ('),
    feedFn.indexOf(')', feedFn.indexOf("and cu.status = 'active'"))
  );
  assert.ok(membershipBlock.includes("hm.status = 'verified'"),
    'the membership predicate block must be locatable');
  assert.ok(!/\bor\b/i.test(membershipBlock),
    'the membership predicate must contain no OR relaxation');
  assert.ok(!/exempt/i.test(feedFn),
    'the household feed must carry no exemption parameter or branch');

  // The resident handler must not accept or forward any exemption/household input.
  assert.match(residentHouseholdMessages, /requireActor\(/,
    'the resident feed authorizes on the actor only');
  assert.ok(!/requireVerifiedResident/.test(residentHouseholdMessages),
    'the resident feed must not use the exemption-aware resident gate');
  assert.ok(!/exempt/i.test(residentHouseholdMessages),
    'the resident household message handler must know nothing about the exemption');
  assert.doesNotMatch(residentHouseholdMessages, /building_code|unit_code|target_selector/,
    'the resident feed must never accept a caller-supplied household target');

  // Admin-side targeting must stay a PADIEM-scope surface with its own membership
  // predicate, never the resident exemption.
  assert.match(adminHouseholdMessaging, /const SCOPE = 'household\.message\.manage'/,
    'admin household messaging must keep its own dedicated scope');
  assert.match(adminHouseholdMessaging, /hm\.status = 'verified'/,
    'admin household targeting must resolve recipients from verified memberships');
  assert.ok(!/requireVerifiedResident/.test(adminHouseholdMessaging),
    'admin household messaging must not route through the exemption-aware resident gate');
  assert.ok(!/residentVerificationExempt/.test(adminHouseholdMessaging),
    'admin household messaging must never consult the exemption');

  // The household family surface keeps its own household-required boundary.
  assert.match(householdFamily, /HOUSEHOLD_ASSOCIATION_REQUIRED/,
    'the household family surface must keep its real household-required boundary');
  assert.ok(!/residentVerificationExempt/.test(householdFamily),
    'the household family surface must never widen on the exemption');
}

/* ==== 5. no product code pairs the exemption with a fabricated household ==== */
{
  // A single sweep of the household-side modules: the exemption flag must never
  // appear in a module whose essence is a household. `authorization-v2.ts` is the
  // only module allowed to NAME the flag alongside null fields; the self-facing
  // label logic in `resident-profile-v1.ts` is pinned separately in section 2b.
  const offenders = [];
  for (const [name, source] of Object.entries({
    'resident-blocks-v1.ts': blocks,
    'resident-messages-v1.ts': messages,
    'resident-safety-reports-v1.ts': safety,
    'resident-household-messages-v1.ts': residentHouseholdMessages,
    'admin-household-messaging-v1.ts': adminHouseholdMessaging,
    'household-family-v2.ts': householdFamily
  })) {
    if (/residentVerificationExempt|RESIDENT_VERIFICATION_EXEMPT_SCOPE/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, [],
    'no household-specific module may consult the exemption flag');
}

console.log('PASS admin resident-verification exemption household boundary (server)');
