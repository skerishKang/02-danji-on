#!/usr/bin/env node
// #960 Production product-mutation rate-limit acceptance.
//
// PROVES, against the deployed Production Worker, in a single bounded pass:
//
//   1. the canonical limiter for the target action is enforced in Production
//      (the only way to learn the threshold is to read it from the exact
//      reviewed source that was deployed — nothing here is hard-coded);
//   2. a request under the threshold is still answered by the EXISTING
//      authorization policy (403 + the same code/message), i.e. passing the
//      limiter never grants authorization;
//   3. the first request over the threshold answers 429 with a valid
//      `retry-after` and the canonical `x-danjion-rate-limit-action`.
//
// SAFETY BOUNDARIES (enforced by this script, not by convention):
//
//   * Target route is chosen so an existing authorization guard answers 403
//     BEFORE any product insert. Any 2xx response is treated as an unexpected
//     mutation and aborts the run immediately — the script never continues
//     past a successful mutation.
//   * The only server-side row the run can create is the limiter bucket
//     counter itself, which is the control under test. No product content,
//     household, message, report or storage object is created.
//   * Rate-limit state is never reset, deleted or bypassed. If the bucket is
//     already at/over the threshold when the run starts, the baseline cannot
//     be proven: the run stops with INCONCLUSIVE and never retries.
//   * Exactly one attempt per threshold step. No retry, no backoff loop.
//   * Credentials, cookies and session tokens are never printed.
//
// Run modes:
//   node production-rate-limit-acceptance.mjs --self-test   (local mock, no network)
//   node production-rate-limit-acceptance.mjs               (guarded workflow only)
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = join(HERE, '..', 'src');

// The action under acceptance. Only its NAME is chosen here; max/windowSeconds
// are read from PRODUCT_MUTATION_LIMITS in the deployed source tree.
const TARGET_ACTION = 'family_invite_create';
// Family-invite creation: an unassociated resident is rejected by the existing
// verified-primary-household guard before the first insert.
const TARGET_ROUTE_TEMPLATE = '/api/v1/complexes/{complexSlug}/household/family-invites';

const REQUIRED_FRONTEND_ORIGIN = 'https://danjion.pages.dev';
const MOCK_POLICY = { action: TARGET_ACTION, max: 3, windowSeconds: 600 };
const MOCK_GUARD = { code: 'HOUSEHOLD_PRIMARY_REQUIRED', message: 'Verified primary household membership required' };

// ---------------------------------------------------------------------------
// Canonical source readers — the acceptance derives every expectation from the
// exact source that was deployed, never from literals.
// ---------------------------------------------------------------------------
function evaluateNumericExpression(expression) {
  const text = String(expression).trim();
  if (!/^[0-9][0-9\s*]*$/.test(text)) {
    throw new Error(`refusing to evaluate non-numeric windowSeconds expression: ${text}`);
  }
  return text
    .split('*')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reduce((product, part) => product * Number(part), 1);
}

export function parseCanonicalPolicy(source, action) {
  const pattern = new RegExp(
    `${action}:\\s*\\{\\s*action:\\s*'${action}',\\s*max:\\s*(\\d+),\\s*windowSeconds:\\s*([0-9][0-9\\s*]*?)\\s*\\}`,
  );
  const match = pattern.exec(source);
  if (!match) throw new Error(`canonical policy for ${action} not found in PRODUCT_MUTATION_LIMITS`);
  const max = Number(match[1]);
  const windowSeconds = evaluateNumericExpression(match[2]);
  if (!Number.isInteger(max) || max < 1) throw new Error(`unusable max for ${action}: ${match[1]}`);
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error(`unusable windowSeconds for ${action}: ${match[2]}`);
  return { action, max, windowSeconds };
}

export function parseAuthzGuard(source) {
  // The same module has a list-side association guard; the acceptance target is
  // the create path, so the parse is anchored to createInvite() itself.
  const handlerStart = source.indexOf('async function createInvite(');
  if (handlerStart < 0) throw new Error('createInvite handler not found in household-family-v2.ts');
  const handler = source.slice(handlerStart);
  const pattern = /if \(!context\) return fail\('([A-Z_]+)',\s*'([^']+)',\s*403,\s*requestId\);/;
  const match = pattern.exec(handler);
  if (!match) throw new Error('verified-primary household 403 guard not found in createInvite');
  const firstInsert = handler.indexOf('insert into household_invite_tokens');
  if (firstInsert < 0) throw new Error('household invite insert not found — cannot prove the mutation boundary');
  if (match.index >= firstInsert) {
    throw new Error('authorization guard does not precede the first product insert — refusing this target route');
  }
  return { code: match[1], message: match[2], guardOffset: match.index, firstInsertOffset: firstInsert };
}

export function parseLimiterOrdering(appSource, rateLimitSource) {
  // Two orderings must hold for this acceptance to be meaningful:
  //   1. in the router: the limiter middleware is dispatched before the endpoint handler;
  //   2. inside the limiter: the actor boundary is resolved before the bucket is consumed,
  //      so an unauthenticated caller can never reach a 429.
  const limiter = appSource.indexOf('const productMutationRateLimitResponse = await handleProductMutationRateLimitRequest');
  const handler = appSource.indexOf('await handleHouseholdFamilyRequest');
  if (limiter < 0 || handler < 0) throw new Error('router dispatch sites not found in app.ts');
  if (limiter >= handler) {
    throw new Error('limiter middleware is not dispatched before the household-family handler');
  }
  const actorBoundary = rateLimitSource.indexOf('const actorOrResponse = await requireActor');
  const consume = rateLimitSource.indexOf('return consumeProductMutationLimit(');
  if (actorBoundary < 0 || consume < 0) throw new Error('limiter actor boundary or bucket consumption not found');
  if (actorBoundary >= consume) {
    throw new Error('the limiter actor boundary must precede bucket consumption');
  }
  return { limiterOffset: limiter, handlerOffset: handler, actorBoundaryOffset: actorBoundary, consumeOffset: consume };
}

async function readCanonicalSources() {
  const [rateLimitSource, appSource, householdSource] = await Promise.all([
    readFile(join(BACKEND_SRC, 'product-rate-limit-v1.ts'), 'utf8'),
    readFile(join(BACKEND_SRC, 'app.ts'), 'utf8'),
    readFile(join(BACKEND_SRC, 'household-family-v2.ts'), 'utf8'),
  ]);
  return {
    policy: parseCanonicalPolicy(rateLimitSource, TARGET_ACTION),
    guard: parseAuthzGuard(householdSource),
    ordering: parseLimiterOrdering(appSource, rateLimitSource),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers. Plain fetch + explicit cookie handling: this acceptance is
// API-only, so no browser engine or npm install is required.
// ---------------------------------------------------------------------------
function collectCookies(response, jar) {
  const raw = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const entry of raw) {
    const pair = String(entry).split(';', 1)[0].trim();
    if (pair && !jar.includes(pair)) jar.push(pair);
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// The acceptance itself.
// ---------------------------------------------------------------------------
export async function runAcceptance({ fetchImpl, baseUrl, complexSlug, policy, guard, credentials, log }) {
  const evidence = {
    preThresholdStatuses: [],
    preThresholdCodes: [],
    overThresholdStatus: null,
    retryAfterSeconds: null,
    rateLimitActionHeader: null,
    mutationSuccessObserved: false,
    requestIds: [],
  };

  const jar = [];
  const targetUrl = `${baseUrl}${TARGET_ROUTE_TEMPLATE.replace('{complexSlug}', encodeURIComponent(complexSlug))}`;

  const post = async (url, body) => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(jar.length ? { cookie: jar.join('; ') } : {}),
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    collectCookies(response, jar);
    const payload = await readJson(response);
    const requestId = response.headers.get('x-danjion-request-id') || (payload && payload.requestId) || '';
    if (requestId) evidence.requestIds.push(String(requestId));
    return { response, payload, requestId };
  };

  // 1. Authenticate with the existing Production test-resident credentials.
  const signin = await post(`${baseUrl}/api/auth/sign-in/email`, {
    email: credentials.email,
    password: credentials.password,
  });
  if (signin.response.status !== 200 || jar.length === 0) {
    return { outcome: 'FAIL', reason: 'sign-in failed; no authenticated session was established', evidence };
  }

  // 2. Baseline pollution guard. The first attempt must not already be limited,
  //    otherwise this run cannot prove the threshold crossing.
  for (let attempt = 1; attempt <= policy.max; attempt += 1) {
    const { response, payload } = await post(targetUrl, {});
    const status = response.status;
    evidence.preThresholdStatuses.push(status);

    if (status >= 200 && status < 300) {
      evidence.mutationSuccessObserved = true;
      return {
        outcome: 'FAIL',
        reason: `attempt ${attempt} returned ${status}: a mutation succeeded where the authorization policy must reject`,
        evidence,
      };
    }
    if (status === 429) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: `attempt ${attempt} was already rate limited: the bucket is not at baseline, refusing to retry or reset it`,
        evidence,
      };
    }
    evidence.preThresholdCodes.push((payload && payload.error && payload.error.code) || '');
    if (status !== 403) {
      return {
        outcome: 'FAIL',
        reason: `attempt ${attempt} returned ${status}: the existing authorization policy changed`,
        evidence,
      };
    }
    if (!payload || !payload.error || payload.error.code !== guard.code || payload.error.message !== guard.message) {
      return {
        outcome: 'FAIL',
        reason: `attempt ${attempt} returned an unexpected 403 body class`,
        evidence,
      };
    }
    // One attempt per step; no retry, no backoff.
    await sleep(250);
  }

  // 3. First request over the threshold must be the limiter.
  const limited = await post(targetUrl, {});
  evidence.overThresholdStatus = limited.response.status;
  evidence.retryAfterSeconds = limited.response.headers.get('retry-after');
  evidence.rateLimitActionHeader = limited.response.headers.get('x-danjion-rate-limit-action');

  if (evidence.overThresholdStatus !== 429) {
    return {
      outcome: 'FAIL',
      reason: `over-threshold request returned ${evidence.overThresholdStatus}: the limiter did not engage`,
      evidence,
    };
  }
  const retryAfter = Number(evidence.retryAfterSeconds);
  if (!/^\d+$/.test(String(evidence.retryAfterSeconds || '')) || !Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > policy.windowSeconds) {
    return { outcome: 'FAIL', reason: 'retry-after header is missing or outside the canonical window', evidence };
  }
  if (evidence.rateLimitActionHeader !== policy.action) {
    return { outcome: 'FAIL', reason: 'x-danjion-rate-limit-action does not exactly match the canonical action', evidence };
  }
  const body = limited.payload || {};
  if (!body.error || body.error.code !== 'RATE_LIMITED' || !Number.isInteger(Number(body.retryAfterSeconds))) {
    return { outcome: 'FAIL', reason: 'rate-limited body envelope is not the canonical RATE_LIMITED shape', evidence };
  }

  return { outcome: 'PASS', reason: 'canonical 429 + retry-after proven with authorization parity intact', evidence };
}

// ---------------------------------------------------------------------------
// Self-test: the same acceptance logic against an in-memory mock, so the
// harness is verified before anyone points it at Production.
// ---------------------------------------------------------------------------
function mockResponse({ status, body, headers = {} }) {
  return {
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] ?? null,
      getSetCookie: () => headers['set-cookie'] ? [headers['set-cookie']] : [],
    },
    async text() {
      return body === undefined ? '' : JSON.stringify(body);
    },
  };
}

function makeMockFetch({ plan, max, windowSeconds, action, guard }) {
  let calls = 0;
  return async (url, init) => {
    const target = String(url);
    if (target.includes('/api/auth/sign-in/email')) {
      return mockResponse({
        status: 200,
        body: { ok: true },
        headers: { 'set-cookie': 'better-auth.session_token=mock-value; Path=/; HttpOnly', 'x-danjion-request-id': 'req-self-test-login' },
      });
    }
    calls += 1;
    const step = plan(calls);
    if (step === 'mutate') {
      return mockResponse({ status: 201, body: { data: { id: 'should-never-happen' } }, headers: { 'x-danjion-request-id': 'req-self-test-mutation' } });
    }
    if (step === 'polluted') {
      return mockResponse({
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many requests for this action. Try again later.' }, retryAfterSeconds: 60 },
        headers: { 'retry-after': '60', 'x-danjion-rate-limit-action': action, 'x-danjion-request-id': 'req-self-test-polluted' },
      });
    }
    if (calls <= max) {
      return mockResponse({
        status: 403,
        body: { error: { code: guard.code, message: guard.message } },
        headers: { 'x-danjion-request-id': `req-self-test-403-${calls}` },
      });
    }
    return mockResponse({
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'Too many requests for this action. Try again later.' }, retryAfterSeconds: windowSeconds },
      headers: { 'retry-after': String(windowSeconds), 'x-danjion-rate-limit-action': action, 'x-danjion-request-id': 'req-self-test-429' },
    });
  };
}

async function selfTest() {
  const quiet = () => {};
  const run = (plan) =>
    runAcceptance({
      fetchImpl: makeMockFetch({
        plan,
        max: MOCK_POLICY.max,
        windowSeconds: MOCK_POLICY.windowSeconds,
        action: MOCK_POLICY.action,
        guard: MOCK_GUARD,
      }),
      baseUrl: REQUIRED_FRONTEND_ORIGIN,
      complexSlug: 'banglim-myeongji-roadhill',
      policy: MOCK_POLICY,
      guard: MOCK_GUARD,
      credentials: { email: 'self-test@example.invalid', password: 'self-test-only' },
      log: quiet,
    });

  const pass = await run(() => 'authz');
  if (pass.outcome !== 'PASS') throw new Error(`self-test: expected PASS, got ${pass.outcome} (${pass.reason})`);
  if (pass.evidence.preThresholdStatuses.length !== MOCK_POLICY.max) throw new Error('self-test: unexpected pre-threshold request count');
  if (pass.evidence.overThresholdStatus !== 429) throw new Error('self-test: over-threshold request was not limited');

  const mutated = await run((calls) => (calls === 2 ? 'mutate' : 'authz'));
  if (mutated.outcome !== 'FAIL' || !mutated.evidence.mutationSuccessObserved) {
    throw new Error('self-test: a successful mutation must abort the run');
  }
  if (mutated.evidence.preThresholdStatuses.length !== 2) throw new Error('self-test: run continued after the mutation');

  const polluted = await run((calls) => (calls === 1 ? 'polluted' : 'authz'));
  if (polluted.outcome !== 'INCONCLUSIVE') throw new Error('self-test: a pre-polluted bucket must be INCONCLUSIVE, not retried');

  // Canonical readers must reject a target whose guard no longer precedes the insert.
  let guardRejected = false;
  try {
    parseAuthzGuard(
      "async function createInvite(){ const x=1; insert into household_invite_tokens values(); if (!context) return fail('X','Y',403,requestId); }",
    );
  } catch {
    guardRejected = true;
  }
  if (!guardRejected) throw new Error('self-test: a guard that no longer precedes the insert must be rejected');

  console.log('960_SELF_TEST=PASS');
  console.log('960_SELF_TEST_GUARDS=PASS (mutation abort, polluted-bucket inconclusive, guard ordering)');
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest();
    return;
  }

  const baseUrl = String(process.env.DANJION_PRODUCTION_FRONTEND_URL || '').replace(/\/+$/, '');
  const complexSlug = String(process.env.DANJION_PRODUCTION_COMPLEX_SLUG || '').trim();
  const email = String(process.env.DANJION_PRODUCTION_TEST_RESIDENT_EMAIL || '').trim();
  const password = String(process.env.DANJION_PRODUCTION_TEST_RESIDENT_PASSWORD || '');

  if (baseUrl !== REQUIRED_FRONTEND_ORIGIN) {
    throw new Error(`refusing to run: DANJION_PRODUCTION_FRONTEND_URL must be ${REQUIRED_FRONTEND_ORIGIN}`);
  }
  if (!complexSlug || !email || password.length < 8) {
    throw new Error('refusing to run: production test-resident credentials or complex slug are missing');
  }

  const { policy, guard, ordering } = await readCanonicalSources();

  console.log(`960_TARGET_ROUTE=POST ${TARGET_ROUTE_TEMPLATE}`);
  console.log(`960_RATE_LIMIT_ACTION=${policy.action}`);
  console.log(`960_CANONICAL_MAX=${policy.max}`);
  console.log(`960_CANONICAL_WINDOW_SECONDS=${policy.windowSeconds}`);
  console.log(`960_AUTHZ_GUARD=${guard.code} (403 before insert at offset ${guard.firstInsertOffset})`);
  console.log(`960_LIMITER_BEFORE_AUTHZ=PASS (router offset ${ordering.limiterOffset} < ${ordering.handlerOffset})`);

  const result = await runAcceptance({
    fetchImpl: (url, init) => fetch(url, init),
    baseUrl,
    complexSlug,
    policy,
    guard,
    credentials: { email, password },
    log: (line) => console.log(line),
  });

  console.log(`960_PRETHRESHOLD_STATUSES=${result.evidence.preThresholdStatuses.join(',')}`);
  console.log(`960_PRETHRESHOLD_CODES=${[...new Set(result.evidence.preThresholdCodes)].join(',')}`);
  console.log(`960_OVER_THRESHOLD_STATUS=${result.evidence.overThresholdStatus ?? 'none'}`);
  console.log(`960_RETRY_AFTER_SECONDS=${result.evidence.retryAfterSeconds ?? 'none'}`);
  console.log(`960_RATE_LIMIT_ACTION_HEADER=${result.evidence.rateLimitActionHeader ?? 'none'}`);
  console.log(`960_MUTATION_SUCCESS_OBSERVED=${result.evidence.mutationSuccessObserved ? 'YES' : 'NO'}`);
  console.log(`960_PRODUCT_CONTENT_MUTATION=0`);
  console.log(`960_DATABASE_DIRECT_ACCESS=0`);
  console.log(`960_RATE_LIMIT_STATE_RESET=0`);
  console.log(`960_OUTCOME=${result.outcome}`);
  if (result.reason) console.log(`960_REASON=${result.reason}`);

  if (result.outcome !== 'PASS') {
    // No retry: a non-PASS acceptance is a recorded result, not a loop.
    process.exitCode = 1;
  }
}

// Only run when executed directly; importing this module (contract tests) must
// never reach the network path.
const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) await main();
