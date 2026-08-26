import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [auth, authSchema, limiter, migration, app, community, household, economy] = await Promise.all([
  readFile(new URL('src/auth-better-v1.ts', root), 'utf8'),
  readFile(new URL('src/auth-better-schema.ts', root), 'utf8'),
  readFile(new URL('src/product-rate-limit-v1.ts', root), 'utf8'),
  readFile(new URL('migrations/018_security_abuse_rate_limits.sql', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
  readFile(new URL('src/household-family-v2.ts', root), 'utf8'),
  readFile(new URL('src/resident-economy-v2.ts', root), 'utf8')
]);

// Better Auth keeps its built-in global/sensitive endpoint policy while moving
// serverless state to its own danjion_auth database model.
assert.match(auth, /rateLimit:\s*\{\s*storage:\s*'database',\s*modelName:\s*'rateLimit'\s*\}/s);
assert.match(auth, /advanced:\s*\{\s*ipAddress:\s*\{\s*ipAddressHeaders:\s*\['cf-connecting-ip'\]/s);
assert.doesNotMatch(auth, /ipAddressHeaders:[^\]]*x-forwarded-for/s,
  'Better Auth must use the Cloudflare-owned connecting IP header instead of a client-spoofable fallback');
assert.doesNotMatch(auth, /customRules\s*:/,
  'Issue #92 must preserve Better Auth built-in sensitive endpoint rules rather than replacing them');

assert.match(authSchema, /rateLimit\s*=\s*danjionAuthSchema\.table\('rate_limit'/);
assert.match(authSchema, /lastRequest:\s*bigint\('last_request',\s*\{\s*mode:\s*'number'\s*\}\)/);
assert.match(authSchema, /betterAuthSchema\s*=\s*\{[^}]*rateLimit/s);
assert.match(migration, /create table if not exists danjion_auth\.rate_limit/i);
assert.match(migration, /last_request bigint not null/i);
assert.match(migration, /unique index[^;]*rate_limit_key_uidx[^;]*rate_limit \(key\)/is);
assert.doesNotMatch(migration, /create\s+(?:table|schema).*neon_auth/i,
  'Issue #92 must never modify Neon-managed neon_auth');

// Product mutation counter is actor-only and atomic. No resident PII is a key.
assert.match(migration, /create table if not exists product_mutation_rate_limits/i);
assert.match(migration, /actor_user_id uuid not null references app_users\(id\)/i);
assert.match(migration, /primary key \(actor_user_id, action, window_start\)/i);
assert.doesNotMatch(migration, /\b(email|phone|building|unit|dong|ho)\b/i,
  'product rate-limit persistence must not contain resident PII columns');
assert.match(limiter, /requireActor\(request, env, sql, requestId\)/);
assert.match(limiter, /actorOrResponse\.id/);
assert.doesNotMatch(limiter, /x-danjion-role|x-danjion-verified|x-danjion-complex/,
  'client role/verification/complex headers must never influence rate-limit identity');
assert.doesNotMatch(limiter, /email|phone|building|unitCode|buildingCode/,
  'product rate-limit identity must not use resident PII');
assert.match(limiter, /on conflict \(actor_user_id, action, window_start\)[\s\S]*request_count = product_mutation_rate_limits\.request_count \+ 1/i,
  'concurrent product requests must consume one atomic database counter');
assert.match(limiter, /status:\s*429/);
assert.match(limiter, /'retry-after':\s*String\(retryAfter\)/);
assert.match(limiter, /RATE_LIMIT_PASS != AUTHORIZATION_PASS/);

const expectedPolicies = [
  ["community_post_create", 5, '10 * 60'],
  ["community_comment_create", 30, '10 * 60'],
  ["community_report_create", 10, '60 * 60'],
  ["family_invite_create", 10, '60 * 60'],
  ["family_invite_redeem", 10, '60 * 60'],
  ["business_application_create", 5, '24 * 60 * 60'],
  ["benefit_claim", 30, '60 * 60']
];
for (const [action, max, windowExpr] of expectedPolicies) {
  assert.ok(limiter.includes(`${action}: { action: '${action}', max: ${max}, windowSeconds: ${windowExpr} }`),
    `missing bounded policy ${action}`);
}

for (const routeEvidence of [
  'community\\/posts$',
  'community\\/posts\\/[0-9a-fA-F-]+\\/comments$',
  'community\\/reports$',
  'household\\/family-invites$',
  "path === '/api/v1/household/family-invites/redeem'",
  "path === '/api/v1/me/business-applications'",
  'benefits\\/[0-9a-fA-F-]+\\/claim$'
]) {
  assert.ok(limiter.includes(routeEvidence), `missing bounded mutation route evidence ${routeEvidence}`);
}
assert.match(limiter, /if \(request\.method !== 'POST'\) return null/,
  'non-POST surfaces must not be swept into the product mutation limiter');
assert.doesNotMatch(limiter, /community\/moderation|\/moderate|\/resolve/,
  'operator moderation is outside the bounded Issue #92 product limiter');

// The limiter is a pre-handler guard; all existing endpoint AuthZ remains in place.
const limitIndex = app.indexOf('handleProductMutationRateLimitRequest(request, env, id)');
for (const downstream of [
  'handleHouseholdFamilyRequest(request, env, id)',
  'handleCommunityResidentRequest(request, env, id)',
  'handleResidentEconomyMutationRequest(request, env, id)'
]) {
  const downstreamIndex = app.indexOf(downstream);
  assert.ok(limitIndex >= 0 && downstreamIndex > limitIndex, `rate limiter must run before ${downstream}`);
}
assert.match(community, /requireVerifiedResident\(/,
  'Community authorization remains authoritative after rate-limit PASS');
assert.match(household, /requireActor\(/,
  'Household family authorization remains authoritative after rate-limit PASS');
assert.match(economy, /requireVerifiedResident\(/,
  'resident economy authorization remains authoritative after rate-limit PASS');

console.log('PASS database-backed auth + bounded actor product mutation abuse-limit contract');
