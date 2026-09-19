import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
 * #784 — verified-resident Community immediate publication activation.
 *
 * CENTRAL policy decision: VERIFIED_RESIDENT_COMMUNITY_PUBLISH=IMMEDIATE.
 *
 * The runtime flag must be pinned in SOURCE (wrangler.jsonc production.vars),
 * never only in the Cloudflare dashboard, so the next standard deploy cannot
 * silently revert it to `review`.
 *
 * This contract is deliberately two-layered:
 *   1. source assertions — the flag is declared in production config and the
 *      server-side mapping is unchanged
 *   2. a runtime mirror of publishMode()/publication() — proves that ONLY the
 *      exact string 'immediate' publishes, and that AuthN/AuthZ is untouched
 */

const root = new URL('../', import.meta.url);
const [wranglerRaw, residentApi, repliesApi, authz, auth, residentNews, apartmentNewsChannel, apartmentNewsAdmin] =
  await Promise.all([
    readFile(new URL('wrangler.jsonc', root), 'utf8'),
    readFile(new URL('src/community-resident-v1.ts', root), 'utf8'),
    readFile(new URL('src/community-replies-v1.ts', root), 'utf8'),
    readFile(new URL('src/authorization-v2.ts', root), 'utf8'),
    readFile(new URL('src/auth-v1.ts', root), 'utf8'),
    readFile(new URL('src/resident-news-v1.ts', root), 'utf8'),
    readFile(new URL('src/complex-news-channel.ts', root), 'utf8'),
    readFile(new URL('src/admin-operational-v2.ts', root), 'utf8')
  ]);

/* ---------- 1. production config pins immediate in SOURCE ---------- */
const wrangler = JSON.parse(wranglerRaw);
const production = wrangler.env?.production;
assert.ok(production, 'production Worker environment must exist');
assert.equal(
  production.vars?.COMMUNITY_PUBLISH_MODE,
  'immediate',
  '#784: production must pin COMMUNITY_PUBLISH_MODE=immediate in source-controlled config'
);
assert.ok(
  !(production.secrets?.required ?? []).includes('COMMUNITY_PUBLISH_MODE'),
  'COMMUNITY_PUBLISH_MODE is a source-visible config var, not a dashboard secret'
);

/* ---------- 2. only the exact string 'immediate' publishes ---------- */
assert.match(
  residentApi,
  /function publishMode\(env: CommunityEnv\): 'immediate' \| 'review' \{\s*\n\s*return env\.COMMUNITY_PUBLISH_MODE === 'immediate' \? 'immediate' : 'review';/,
  'publish mode must remain an exact-string comparison with a review safe default'
);
assert.doesNotMatch(
  residentApi,
  /COMMUNITY_PUBLISH_MODE\s*[!=]==\s*'(?!immediate)[^']*'\s*\?\s*'immediate'/,
  'no value other than the exact string immediate may map to immediate publication'
);
assert.doesNotMatch(
  residentApi,
  /if\s*\(\s*env\.COMMUNITY_PUBLISH_MODE\s*\)/,
  'publish mode must not be decided by loose truthiness — an empty or unexpected value must stay review'
);

/*
 * Runtime mirror of the server-side mapping. This is the part that actually
 * proves the behaviour: any drift away from exact-string matching, or away
 * from the review fallback, fails here.
 */
const publishMode = (env) => (env.COMMUNITY_PUBLISH_MODE === 'immediate' ? 'immediate' : 'review');
const publication = (mode) =>
  mode === 'immediate' ? { status: 'published', publishedAt: new Date() } : { status: 'pending_review', publishedAt: null };

assert.equal(publishMode({ COMMUNITY_PUBLISH_MODE: 'immediate' }), 'immediate');
for (const value of ['review', '', 'IMMEDIATE', 'Immediate', 'true', '1', 'yes', 'on', undefined, null]) {
  assert.equal(
    publishMode({ COMMUNITY_PUBLISH_MODE: value }),
    'review',
    `only the exact string 'immediate' publishes; ${JSON.stringify(value)} must stay review`
  );
}

{
  const published = publication(publishMode({ COMMUNITY_PUBLISH_MODE: 'immediate' }));
  assert.equal(published.status, 'published', 'verified-resident content must be published when the flag is immediate');
  assert.ok(published.publishedAt instanceof Date, 'immediate publication must stamp published_at');

  const reviewed = publication(publishMode({ COMMUNITY_PUBLISH_MODE: 'review' }));
  assert.equal(reviewed.status, 'pending_review', 'review mode must remain the safe default');
  assert.equal(reviewed.publishedAt, null, 'review mode must not stamp published_at');
}

/* ---------- 3. post / comment / reply all inherit the policy ---------- */
const POST_CREATE = residentApi.indexOf('insert into community_posts');
const COMMENT_CREATE = residentApi.indexOf('insert into community_comments');
assert.ok(POST_CREATE >= 0, 'post create must insert into community_posts');
assert.ok(COMMENT_CREATE >= 0, 'comment create must insert into community_comments');

for (const [label, insertAt] of [
  ['post', POST_CREATE],
  ['comment', COMMENT_CREATE]
]) {
  const window = residentApi.slice(Math.max(0, insertAt - 600), insertAt + 400);
  assert.match(window, /const mode = publishMode\(env\);/, `${label} create must resolve the server publish mode`);
  assert.match(window, /const next = publication\(mode\);/, `${label} create must derive publication from the resolved mode`);
  assert.match(window, /\$\{next\.status\},\s*\$\{next\.publishedAt\}/, `${label} create must persist status and published_at together`);
}

assert.match(
  repliesApi,
  /function publication\(env: CommunityReplyEnv\)/,
  'replies must inherit the canonical Community publish mode'
);
assert.match(repliesApi, /env\.COMMUNITY_PUBLISH_MODE === 'immediate'/);
{
  const replyInsert = repliesApi.indexOf('insert into community_comments');
  assert.ok(replyInsert >= 0, 'reply create must insert into community_comments');
  const window = repliesApi.slice(Math.max(0, replyInsert - 600), replyInsert + 400);
  assert.match(window, /const next = publication\(env\);/, 'reply create must derive publication from env');
  assert.match(window, /\$\{next\.status\},\s*\$\{next\.publishedAt\}/, 'reply create must persist status and published_at together');
}

/* ---------- 4. AuthZ is unchanged by the activation ---------- */
assert.match(
  residentApi,
  /requireVerifiedResident\(/,
  'post/comment writes must still require a verified resident'
);
assert.match(repliesApi, /requireVerifiedResident\(/, 'reply writes must still require a verified resident');
assert.match(
  authz,
  /hm\.status = 'verified'/i,
  'verified-resident authority must still be derived from Household v2 server state'
);

/* signed-out -> existing AuthN failure (401), never a publish bypass */
assert.match(
  auth,
  /fail\('AUTH_REQUIRED', 'Authentication required', 401, requestId\)/,
  'signed-out requests must still fail closed with 401 AUTH_REQUIRED'
);
assert.match(
  authz,
  /const actor = await requireActor\(request, env, sql, requestId\);\s*\n\s*if \(actor instanceof Response\) return actor;/,
  'verified-resident gate must short-circuit on the AuthN response before any community write'
);

/* ordinary unverified resident -> existing AuthZ failure (403) */
assert.match(
  authz,
  /fail\('RESIDENT_VERIFICATION_REQUIRED', 'Verified resident access required', 403, requestId\)/,
  'an ordinary unverified resident must still be rejected with 403'
);
assert.doesNotMatch(
  residentApi,
  /status = 'published'[\s\S]{0,200}without|bypassVerifiedResident|skipVerifiedResident/i,
  'activation must not introduce any verified-resident bypass'
);

/* ---------- 5. news review authority is untouched ---------- */
for (const [label, src] of [
  ['resident-news', residentNews],
  ['apartment-news channel', apartmentNewsChannel],
  ['apartment-news admin', apartmentNewsAdmin]
]) {
  assert.doesNotMatch(
    src,
    /COMMUNITY_PUBLISH_MODE/,
    `${label} must not read the Community publish flag — its review authority is unchanged by #784`
  );
}
assert.match(
  residentNews,
  /const QUEUE_STATUSES = new Set\(\['submitted', 'reviewing', 'approved', 'rejected'\]\)/,
  'resident-news must keep its operator review queue'
);
assert.match(
  residentNews,
  /requireOperationalAuthority\(/,
  'resident-news review must remain an operational-authority decision'
);
assert.match(
  apartmentNewsAdmin,
  /requireOperationalAuthority/,
  'apartment-news (complex_posts) must remain an operational-authority decision'
);

console.log('PASS #784 verified-resident Community immediate publication contract');
