// #1046: administrator grant bootstrap must be atomic across all runtime scopes,
// and the whole success unit must commit as one.
//
// Defect in `04_개발/backend/src/admin-bootstrap-v1.ts`:
//
//   for (const scope of runtimeScopes) {
//     await sql`insert into padiem_operator_grants (...) on conflict do nothing`;
//   }
//
// Each INSERT committed independently, so a failure part-way through could leave
// bootstrap reporting 503 while earlier grants — including the SUPER wildcard —
// stayed active:
//
//   insert *        COMMITTED
//   insert scope-a  COMMITTED
//   insert scope-b  ERROR
//   bootstrap       503          <- partial elevated authority survives
//
// The fix collects the whole success unit — the grant writes, the authority
// assertion and the allowed audit — into one `sql.transaction(...)`, the pattern
// already used by resident-profile-v1.
//
// This contract is behavioural: it runs the real handler and models real
// transaction commit/rollback semantics in the stub. A bare `throw new Error()`
// with no state tracking would not prove anything about surviving rows.
//
//   Case A  SUPER mid-loop failure        -> no new grant survives, no wildcard
//   Case B  OPERATIONAL mid-loop failure  -> no partial bounded grants
//   Case C  success parity                -> SUPER and OPERATIONAL, no post-commit DB work
//   Case D  idempotent re-bootstrap       -> no duplicates, authority unchanged
//   Case E  allowed-audit failure         -> grants roll back with the audit
//   Case F  unrelated pre-existing grant  -> preserved in DB *and* in the response
//   Case G  assertion abort               -> the handler rolls the unit back
//
// Three mutation proofs re-state rejected algorithms *inside this test* and show
// that the Case A / Case E acceptance rules, and the static assertion guard,
// reject them. No product source text is read, sliced or rewritten here: the
// mutants are models built on the same SQL stub the passing cases use.
//
//   PER_SCOPE_LOOP_MUTATION_PROOF        historical per-scope loop   -> Case A rejects
//   CASE_E_DEDICATED_MUTATION_PROOF      rejected partial-success    -> Case E rejects
//   ASSERTION_SHAPE_MUTATION_PROOF       non-aborting assertion      -> static guard rejects
//
// One honest limitation: the stub is the oracle for the assertion's SQL
// semantics, so these cases cannot prove that the shipped SQL expression is able
// to abort. That is why the assertion shape is additionally pinned statically in
// admin-bootstrap-contract.mjs.
import assert from 'node:assert/strict';
import { bootstrapAdminAuthorityResponse } from '../src/admin-bootstrap-v1.ts';
import {
  SUPER_ADMIN_RUNTIME_SCOPES,
  OPERATIONAL_ADMIN_SCOPES,
  runtimeScopesForRole,
  principalScopesForRole
} from '../src/admin-scope-policy-v1.ts';

const env = {
  DATABASE_URL: 'postgres://synthetic.invalid/danjion',
  APP_ENV: 'test',
  DEV_AUTH_BYPASS: 'true'
};

// The scope sets come from the real policy module, not from a hand-written list,
// so a policy change cannot silently make this contract assert the wrong thing.
const SUPER_SCOPES = [...SUPER_ADMIN_RUNTIME_SCOPES];
const OPERATIONAL_SCOPES = [...OPERATIONAL_ADMIN_SCOPES];
// A real bounded scope, used as the mid-loop failure injection point.
const FAIL_SCOPE = OPERATIONAL_SCOPES[1];
// A real bounded runtime scope, used as the unestablishable-authority injection
// point in Case G.
const BLOCKED_SCOPE = OPERATIONAL_SCOPES[1];

const SUPER_ACTOR_ID = '00000000-0000-4000-8000-000000000201';
const OPERATIONAL_ACTOR_ID = '00000000-0000-4000-8000-000000000202';

const actorsBySubject = new Map([
  ['sub-super', { id: SUPER_ACTOR_ID, auth_user_id: 'ba-super', display_name: 'Super' }],
  ['sub-operational', { id: OPERATIONAL_ACTOR_ID, auth_user_id: 'ba-op', display_name: 'Op' }]
]);

const principalByActor = new Map([
  [SUPER_ACTOR_ID, {
    id: '10000000-0000-0000-8000-000000000001',
    provider: 'google',
    authority_level: 'admin',
    scopes: ['*']
  }],
  [OPERATIONAL_ACTOR_ID, {
    id: '10000000-0000-0000-8000-000000000002',
    provider: 'google',
    authority_level: 'operator',
    // The allowlist row must satisfy isCanonicalPrincipalScopes, so it carries the
    // full bounded bundle from the real policy rather than a hand-picked subset.
    scopes: principalScopesForRole('operator')
  }]
]);

// Postgres SQLSTATE `division_by_zero`, the abort signal of the transactional
// authority assertion in the shipped source.
function assertionAbort() {
  const error = new Error('division by zero');
  error.code = '22012';
  return error;
}

/**
 * A SQL stub that models an actual transaction boundary.
 *
 * Writes executed outside a transaction commit immediately. Writes executed
 * inside `sql.transaction([...])` are staged and only applied to the grant store
 * when the whole set succeeds; if any statement throws, nothing is applied.
 */
function makeSql({
  failOnScope = null,
  failOnAllowedAudit = false,
  existingGrants = [],
  expiredActiveGrants = []
}) {
  const grants = new Map();
  for (const scope of existingGrants) grants.set(scope, { id: 'seed-' + scope, scope, status: 'active' });
  // `status = 'active'` but already expired. Migration 012's partial unique index
  // `(user_id, scope) where status = 'active'` still blocks a re-insert, while the
  // authority filter excludes expired rows, so the scope can never be
  // re-established by an `on conflict do nothing` insert.
  for (const scope of expiredActiveGrants) {
    grants.set(scope, { id: 'expired-' + scope, scope, status: 'active', expired: true });
  }
  const auditEvents = [];
  const stats = {
    transactions: 0,
    successfulTransactions: 0,
    committedWrites: 0,
    rolledBackWrites: 0,
    directWrites: 0,
    // Any statement issued once a transaction has already committed. On the
    // success path this must stay 0: a post-commit read could fail on its own and
    // turn an already committed bootstrap into a 503 response.
    queriesAfterSuccessfulTransaction: 0
  };

  // The authority the database would actually report: active and unexpired.
  const effectiveScopes = () =>
    [...grants.values()]
      .filter((g) => g.status === 'active' && !g.expired)
      .map((g) => g.scope);

  // Applies one write's effect, used both for direct execution and for the
  // commit of a staged transaction.
  const applyGrantWrite = (strings, values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!query.startsWith('insert into padiem_operator_grants')) return false;
    const scope = String(values[1]);
    // `on conflict do nothing`: an existing grant is left exactly as it is, even
    // when it is an expired-but-active row.
    if (grants.has(scope)) return true;
    grants.set(scope, { id: 'g-' + scope, scope, status: 'active' });
    return true;
  };

  async function runQuery(strings, values) {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    if (stats.successfulTransactions > 0) stats.queriesAfterSuccessfulTransaction += 1;

    if (query.includes('join padiem_admin_identity_allowlist p')) {
      const principal = principalByActor.get(String(values[0]));
      return principal ? [principal] : [];
    }

    if (query.includes('from app_users') && !query.includes('padiem_admin_identity_allowlist')) {
      const actor = actorsBySubject.get(String(values[0]));
      return actor ? [actor] : [];
    }

    // The in-transaction authority assertion must be matched before the general
    // grant readback below, because it also selects from padiem_operator_grants.
    if (query.includes('authority_established')) {
      // values: [runtimeScopes, scopeCount, expectedWildcard, actorId]
      const expectedScopes = Array.isArray(values[0]) ? values[0].map(String) : [];
      const expectedCount = Number(values[1]);
      const expectedWildcard = values[2] === true;
      const active = effectiveScopes();
      const expectedPresent = new Set(active.filter((scope) => expectedScopes.includes(scope))).size;
      // Wildcard parity is judged over every active grant, exactly as the
      // pre-existing `resolvePadiemAuthority` readback judged it.
      const wildcardParity = active.includes('*') === expectedWildcard;
      if (expectedPresent !== expectedCount || !wildcardParity) {
        throw assertionAbort();
      }
      // The same statement returns the full active/unexpired scope set, which is
      // what the success response reports. Sorted exactly like the shipped
      // `array_agg(scope order by scope)`.
      return [{ authority_established: 1, active_scopes: [...active].sort() }];
    }

    if (query.startsWith('insert into padiem_operator_grants')) {
      stats.directWrites += 1;
      const scope = String(values[1]);
      if (failOnScope !== null && scope === failOnScope) {
        throw new Error('synthetic mid-loop DB failure on scope ' + scope);
      }
      applyGrantWrite(strings, values);
      return [];
    }

    // Readback branch. The shipped handler must never reach this after the
    // commit — Case C asserts that directly — but the rejected-shape mutation
    // model below needs it to reproduce the historical post-commit read.
    if (query.includes('from padiem_operator_grants')) {
      return effectiveScopes()
        .sort((a, b) => a.localeCompare(b))
        .map((scope) => ({ id: grants.get(scope).id, scope }));
    }

    if (query.startsWith('insert into audit_events')) {
      // The shared auditBootstrap helper interpolates decision and reason_code
      // (six values total), while the in-transaction statement spells both as SQL
      // literals and interpolates only requestId, actorId, null and metadata.
      // Distinguish them by the literal, so neither shape is mis-indexed.
      const inlinesDecision = query.includes("'admin.bootstrap', 'allowed',");
      const decision = inlinesDecision ? 'allowed' : String(values[3]);
      const reasonCode = inlinesDecision ? 'ADMIN_BOOTSTRAP_GRANTED' : String(values[4]);
      const metadata = JSON.parse(String(inlinesDecision ? values[3] : values[5]));
      // The allowed success audit is the final statement of the commit unit; a
      // failure here must roll the staged grants back with it.
      if (failOnAllowedAudit && reasonCode === 'ADMIN_BOOTSTRAP_GRANTED') {
        throw new Error('synthetic ADMIN_BOOTSTRAP_GRANTED audit failure');
      }
      auditEvents.push({ decision, reasonCode, metadata });
      return [];
    }

    throw new Error('Unexpected SQL in atomicity test: ' + query);
  }

  // Mirrors the real neon query function: calling `sql` returns a thenable query
  // object that runs the statement when awaited or when `run()` is called.
  // `sql.transaction([...])` holds those same objects and runs them as one unit.
  // If `sql` executed eagerly instead, the test could never observe transaction
  // semantics at all.
  const sql = (strings, ...values) => {
    let promise = null;
    const run = () => (promise ||= runQuery(strings, values));
    return {
      then: (onOk, onErr) => run().then(onOk, onErr),
      catch: (onErr) => run().catch(onErr),
      finally: (onFinally) => run().finally(onFinally),
      run
    };
  };
  // The real shape of `neon(...).transaction`: it receives the array of query
  // functions and runs them as one unit.
  sql.transaction = async (queries) => {
    assert.ok(Array.isArray(queries), 'transaction must receive the whole write set as an array');
    stats.transactions += 1;
    // Snapshot so a rollback can restore exactly.
    const snapshot = new Map([...grants.entries()].map(([k, v]) => [k, { ...v }]));
    try {
      const results = [];
      for (const q of queries) {
        // Each entry is the query object the source built from a tagged template.
        // `run` bypasses any earlier `await` so staging stays inside the
        // transaction rather than committing at construction time.
        const r = typeof q.run === 'function' ? await q.run() : await q;
        results.push(r);
      }
      stats.committedWrites += queries.length;
      stats.successfulTransactions += 1;
      return results;
    } catch (err) {
      grants.clear();
      for (const [k, v] of snapshot) grants.set(k, v);
      stats.rolledBackWrites += queries.length;
      throw err;
    }
  };
  return { sql, grants, auditEvents, stats };
}

const request = (subject) =>
  new Request('https://danjion.test/api/v1/admin/bootstrap', {
    method: 'POST',
    headers: { 'x-danjion-dev-auth-user': subject }
  });

const scopesOf = (grants) =>
  [...grants.values()]
    .filter((g) => g.status === 'active' && !g.expired)
    .map((g) => g.scope)
    .sort();

// ===========================================================================
// Case A — SUPER, mid-loop failure on a bounded scope after the wildcard was
// already written. Nothing from this attempt may survive.
// ===========================================================================
{
  // The wildcard is written first, then the bounded scopes; the injected
  // failure hits a bounded scope after the wildcard has been staged.
  const { sql, grants, auditEvents, stats } = makeSql({ failOnScope: FAIL_SCOPE });

  const response = await bootstrapAdminAuthorityResponse(request('sub-super'), env, sql, 'req-a');
  const body = await response.json();

  assert.equal(response.status, 503, 'Case A: a mid-loop failure must fail closed with 503');
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_UNAVAILABLE');

  assert.equal(stats.transactions, 1, 'Case A: the grant writes must go through exactly one transaction');
  assert.equal(stats.rolledBackWrites, SUPER_SCOPES.length + 2, 'Case A: the whole commit unit (grants + assertion + success audit) must roll back');
  assert.equal(SUPER_SCOPES.length, runtimeScopesForRole('admin').length, 'Case A: the write set must be exactly the admin runtime scopes');
  assert.equal(stats.committedWrites, 0, 'Case A: no write from the failed attempt may commit');

  const active = scopesOf(grants);
  assert.deepEqual(active, [], 'Case A: no new grant may survive the failed bootstrap');
  assert.equal(grants.has('*'), false, 'Case A: the wildcard must not remain active after a failed bootstrap');
  assert.equal(
    active.some((s) => SUPER_SCOPES.includes(s)),
    false,
    'Case A: no partial scope may remain active'
  );

  // Audit must stay truthful: the attempt failed, so it must not claim granted.
  const last = auditEvents.at(-1);
  assert.equal(last.decision, 'denied', 'Case A: a failed bootstrap must audit as denied');
  assert.equal(last.reasonCode, 'ADMIN_BOOTSTRAP_DATABASE_ERROR');
  assert.equal(
    auditEvents.some((e) => e.reasonCode === 'ADMIN_BOOTSTRAP_GRANTED'),
    false,
    'Case A: a rolled-back bootstrap must never audit ADMIN_BOOTSTRAP_GRANTED'
  );
}

// ===========================================================================
// Case B — OPERATIONAL, no wildcard anywhere, mid-loop failure. A bounded-only
// role must not leave partial grants either.
// ===========================================================================
{
  const { sql, grants, auditEvents, stats } = makeSql({ failOnScope: FAIL_SCOPE });

  const response = await bootstrapAdminAuthorityResponse(request('sub-operational'), env, sql, 'req-b');
  const body = await response.json();

  assert.equal(response.status, 503, 'Case B: a mid-loop failure must fail closed with 503');
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_UNAVAILABLE');
  assert.equal(stats.transactions, 1, 'Case B: the grant writes must go through exactly one transaction');
  assert.equal(stats.rolledBackWrites, OPERATIONAL_SCOPES.length + 2, 'Case B: the whole bounded commit unit must roll back');
  assert.deepEqual(scopesOf(grants), [], 'Case B: no partial bounded grant may remain active');
  assert.equal(grants.has('*'), false, 'Case B: an OPERATIONAL bootstrap must never grant the wildcard');
  const last = auditEvents.at(-1);
  assert.equal(last.reasonCode, 'ADMIN_BOOTSTRAP_DATABASE_ERROR', 'Case B: audit must describe the real failure');
}

// ===========================================================================
// Case C — success parity. SUPER gets the wildcard plus every bounded scope;
// OPERATIONAL gets exactly its bounded scopes and no wildcard. The success path
// must also perform no database work after the commit.
// ===========================================================================
{
  const { sql, grants, auditEvents, stats } = makeSql({ failOnScope: null });

  const response = await bootstrapAdminAuthorityResponse(request('sub-super'), env, sql, 'req-c1');
  const body = await response.json();

  assert.equal(response.status, 200, 'Case C: a successful SUPER bootstrap must return 200');
  assert.equal(stats.transactions, 1);
  assert.equal(stats.rolledBackWrites, 0, 'Case C: a success must not roll anything back');
  assert.equal(stats.committedWrites, SUPER_SCOPES.length + 2, 'Case C: the whole success unit must commit together');
  assert.equal(
    stats.queriesAfterSuccessfulTransaction,
    0,
    'AFTER_SUCCESS_TRANSACTION_DB_OPERATION_THAT_CAN_TURN_RESPONSE_INTO_503=NO'
  );
  assert.deepEqual(scopesOf(grants), [...SUPER_SCOPES].sort(), 'Case C: SUPER must hold the wildcard and every expected scope');
  assert.equal(grants.has('*'), true, 'Case C: SUPER must hold the wildcard');
  assert.deepEqual(body.data, {
    level: 'admin',
    label: '최고관리자',
    scopes: [...SUPER_SCOPES],
    wildcard: true
  }, 'Case C: the SUPER response must report the established authority in canonical order');
  const superAudit = auditEvents.at(-1);
  assert.equal(superAudit.decision, 'allowed');
  assert.equal(superAudit.reasonCode, 'ADMIN_BOOTSTRAP_GRANTED');
  assert.equal(superAudit.metadata.scopeCount, SUPER_SCOPES.length, 'Case C: the allowed audit must describe the real scope count');

  const op = makeSql({ failOnScope: null });
  const opResponse = await bootstrapAdminAuthorityResponse(request('sub-operational'), env, op.sql, 'req-c2');
  const opBody = await opResponse.json();
  assert.equal(opResponse.status, 200, 'Case C: a successful OPERATIONAL bootstrap must return 200');
  assert.equal(
    op.stats.queriesAfterSuccessfulTransaction,
    0,
    'Case C: the OPERATIONAL success path must also do no post-commit database work'
  );
  assert.deepEqual(scopesOf(op.grants), [...OPERATIONAL_SCOPES].sort(), 'Case C: OPERATIONAL must hold exactly its bounded scopes');
  assert.equal(op.grants.has('*'), false, 'Case C: OPERATIONAL must never receive the wildcard');
  assert.deepEqual(opBody.data, {
    level: 'operator',
    label: '일반관리자',
    scopes: [...OPERATIONAL_SCOPES],
    wildcard: false
  }, 'Case C: the OPERATIONAL response must report the established authority in canonical order');
}

// ===========================================================================
// Case D — idempotent re-bootstrap. Existing grants must not be duplicated,
// revoked, widened, narrowed or rewritten.
// ===========================================================================
{
  // Seed exactly what a prior successful bootstrap would have left behind.
  const existing = [...SUPER_SCOPES];
  const { sql, grants, auditEvents, stats } = makeSql({ failOnScope: null, existingGrants: existing });
  const before = scopesOf(grants);

  const response = await bootstrapAdminAuthorityResponse(request('sub-super'), env, sql, 'req-d');
  const body = await response.json();

  assert.equal(response.status, 200, 'Case D: re-bootstrapping an existing principal must still succeed');
  assert.equal(stats.transactions, 1, 'Case D: re-bootstrap must still use the transaction boundary');
  assert.deepEqual(scopesOf(grants), before, 'Case D: authority must be unchanged by a re-bootstrap');
  assert.equal(
    [...grants.values()].filter((g) => g.scope === '*').length,
    1,
    'Case D: re-bootstrap must not create a duplicate wildcard grant'
  );
  assert.equal(
    [...grants.values()].length,
    before.length,
    'Case D: re-bootstrap must not add any grant row'
  );
  assert.equal(body.data.wildcard, true, 'Case D: re-bootstrap must report the same authority');
  assert.equal(auditEvents.at(-1).reasonCode, 'ADMIN_BOOTSTRAP_GRANTED', 'Case D: a successful re-bootstrap audits as granted');
}

// ===========================================================================
// Case E — the success commit unit. The final ADMIN_BOOTSTRAP_GRANTED audit
// INSERT is inside the same transaction as the grants, so if it fails the grants
// must roll back with it. This is the partial-success state CENTRAL rejected:
//
//   grant transaction COMMIT -> readback -> allowed audit
//   ... allowed audit fails  => GRANTS_COMMITTED=YES, API=503, GRANTED audit=NO
// ===========================================================================
for (const [label, subject, role] of [
  ['E1 (SUPER)', 'sub-super', 'admin'],
  ['E2 (OPERATIONAL)', 'sub-operational', 'operator']
]) {
  const { sql, grants, auditEvents, stats } = makeSql({
    failOnScope: null,
    failOnAllowedAudit: true
  });
  const expected = role === 'admin' ? SUPER_SCOPES : OPERATIONAL_SCOPES;

  const response = await bootstrapAdminAuthorityResponse(request(subject), env, sql, 'req-' + label);
  const body = await response.json();

  assert.equal(response.status, 503, `Case ${label}: a failed success audit must return 503`);
  assert.equal(body.error.code, 'ADMIN_BOOTSTRAP_UNAVAILABLE', `Case ${label}: the failure must fail closed`);

  assert.equal(stats.transactions, 1, `Case ${label}: the success unit must be a single transaction`);
  assert.equal(stats.rolledBackWrites, expected.length + 2, `Case ${label}: grants plus the assertion and audit statements must roll back together`);
  assert.equal(stats.committedWrites, 0, `Case ${label}: nothing from the failed unit may commit`);

  const active = scopesOf(grants);
  assert.deepEqual(active, [], `Case ${label}: no grant may survive a failed success audit`);
  assert.equal(grants.has('*'), false, `Case ${label}: the wildcard must not remain active`);
  assert.equal(
    active.some((s) => expected.includes(s)),
    false,
    `Case ${label}: runtime authority must be unchanged after the failure`
  );
  assert.equal(
    auditEvents.filter((e) => e.reasonCode === 'ADMIN_BOOTSTRAP_GRANTED').length,
    0,
    `Case ${label}: the success audit must not be recorded when the unit failed`
  );
}

// ===========================================================================
// Case F — D1_RESPONSE_TRUTH.
//
// An unrelated pre-existing bounded grant must be:
//   REJECT=NO, DELETE=NO, HIDE_FROM_RESPONSE=NO
//
// The pre-#1046 response reported every active/unexpired grant through
// `resolvePadiemAuthority`, so a principal holding an extra bounded grant saw it
// in `data.scopes`. The response must keep saying that, while still doing no
// database work after the commit.
// ===========================================================================
{
  // A real bounded PADIEM scope that is NOT part of the OPERATIONAL runtime
  // bundle, so it can only have come from a different grant path.
  const EXTRA = 'platform.users.read';
  assert.equal(
    OPERATIONAL_SCOPES.includes(EXTRA),
    false,
    'Case F: the extra scope must be outside the OPERATIONAL runtime bundle for this case to mean anything'
  );

  const { sql, grants, auditEvents, stats } = makeSql({ existingGrants: [EXTRA] });

  const response = await bootstrapAdminAuthorityResponse(request('sub-operational'), env, sql, 'req-f');
  const body = await response.json();

  const dbAuthority = scopesOf(grants);

  assert.equal(response.status, 200, 'Case F: an unrelated pre-existing bounded grant must not fail bootstrap');

  assert.equal(grants.has(EXTRA), true, 'EXTRA_GRANT_DB_PRESERVED=YES');
  assert.deepEqual(
    OPERATIONAL_SCOPES.filter((scope) => dbAuthority.includes(scope)).sort(),
    [...OPERATIONAL_SCOPES].sort(),
    'EXPECTED_RUNTIME_SCOPES_PRESENT=YES'
  );
  assert.deepEqual(
    dbAuthority,
    [...OPERATIONAL_SCOPES, EXTRA].sort(),
    'Case F: the extra bounded grant must be neither rejected nor removed'
  );

  assert.equal(body.data.scopes.includes(EXTRA), true, 'RESPONSE_SCOPES_INCLUDE_EXTRA_GRANT=YES');
  assert.deepEqual(
    body.data.scopes,
    dbAuthority,
    'RESPONSE_SCOPES_MATCH_ACTUAL_ACTIVE_AUTHORITY=YES'
  );
  assert.equal(body.data.wildcard, false, 'Case F: OPERATIONAL must never report a wildcard');
  assert.equal(body.data.level, 'operator', 'Case F: level must follow the real active authority');

  assert.equal(stats.queriesAfterSuccessfulTransaction, 0, 'POST_COMMIT_DB_QUERY=0');
  assert.equal(auditEvents.at(-1).reasonCode, 'ADMIN_BOOTSTRAP_GRANTED');
}

// ===========================================================================
// Case G — the handler's contract when the authority assertion aborts.
//
// `business.review` already exists as an ACTIVE but EXPIRED row. Migration 012's
// partial unique index blocks the re-insert, and the authority filter excludes
// expired rows, so the scope can never be re-established. The assertion must
// therefore abort the whole commit unit.
//
// Scope of this proof: the stub is the oracle for the assertion's SQL semantics,
// so Case G proves how the handler behaves *given* an abort — rollback of the
// whole unit, ADMIN_BOOTSTRAP_GRANT_FAILED, and a failed-readback audit — but it
// cannot prove that the shipped SQL expression is able to abort at all. That part
// is guarded statically in admin-bootstrap-contract.mjs, which pins the failure
// branch of the divisor to a literal zero.
// ===========================================================================
{
  assert.ok(
    OPERATIONAL_SCOPES.includes(BLOCKED_SCOPE),
    'Case G: the blocked scope must be a real runtime scope'
  );
  const { sql, grants, auditEvents, stats } = makeSql({ expiredActiveGrants: [BLOCKED_SCOPE] });
  const before = [...grants.keys()].sort();

  const response = await bootstrapAdminAuthorityResponse(request('sub-operational'), env, sql, 'req-g');
  const body = await response.json();

  assert.equal(response.status, 503, 'Case G: an authority that cannot be established must fail closed');
  assert.equal(
    body.error.code,
    'ADMIN_BOOTSTRAP_GRANT_FAILED',
    'Case G: the assertion abort must keep the pre-existing failed-readback error code'
  );
  assert.equal(stats.transactions, 1);
  assert.equal(
    stats.rolledBackWrites,
    OPERATIONAL_SCOPES.length + 2,
    'Case G: the assertion abort must roll back the whole commit unit'
  );
  assert.equal(stats.committedWrites, 0, 'Case G: nothing may commit when the assertion aborts');
  assert.deepEqual(
    [...grants.keys()].sort(),
    before,
    'Case G: the pre-existing expired row must be left exactly as it was'
  );
  assert.deepEqual(scopesOf(grants), [], 'Case G: no effective authority may be established');
  assert.equal(
    auditEvents.filter((e) => e.reasonCode === 'ADMIN_BOOTSTRAP_GRANTED').length,
    0,
    'Case G: an aborted bootstrap must never audit ADMIN_BOOTSTRAP_GRANTED'
  );
  assert.equal(
    auditEvents.at(-1).reasonCode,
    'ADMIN_BOOTSTRAP_GRANT_READBACK_FAILED',
    'Case G: the audit must describe the real failed-readback reason'
  );
}

// ===========================================================================
// PER_SCOPE_LOOP_MUTATION_PROOF — in-test model of the historical algorithm.
//
// The historical implementation awaited one INSERT per scope with no transaction
// boundary, so each INSERT committed on its own. Re-stating that algorithm here
// on the same stub shows that Case A's acceptance rule (NEW_ACTIVE_GRANTS=0)
// rejects exactly the state it leaves behind.
// ===========================================================================
{
  const { sql, grants, stats } = makeSql({ failOnScope: FAIL_SCOPE });

  let loopThrew = false;
  for (const scope of SUPER_SCOPES) {
    try {
      await sql`
        insert into padiem_operator_grants (
          user_id, scope, status, granted_by_user_id, granted_at, reason, metadata
        ) values (
          ${SUPER_ACTOR_ID}::uuid,
          ${scope},
          'active',
          ${null},
          now(),
          'pre-registered administrator bootstrap',
          ${'{}'}::jsonb
        )
        on conflict do nothing
      `;
    } catch {
      loopThrew = true;
      break;
    }
  }

  const surviving = scopesOf(grants);

  assert.equal(loopThrew, true, 'PER_SCOPE_LOOP_MUTATION_PROOF: the historical loop must hit the injected failure');
  assert.equal(stats.transactions, 0, 'PER_SCOPE_LOOP_MUTATION_PROOF: the historical loop used no transaction boundary');
  assert.equal(
    surviving.includes('*'),
    true,
    'PER_SCOPE_LOOP_MUTATION_PROOF: the historical loop leaves the wildcard committed — the exact partial-grant defect Case A rejects'
  );
  assert.equal(surviving.length > 0, true, 'PER_SCOPE_LOOP_MUTATION_PROOF: partial grants survive the failure');
  assert.equal(
    surviving.length === SUPER_SCOPES.length,
    false,
    'PER_SCOPE_LOOP_MUTATION_PROOF: the surviving set is partial, not complete'
  );
  // Case A's acceptance rule must reject exactly this state.
  assert.equal(
    surviving.length === 0,
    false,
    'Case A acceptance (NEW_ACTIVE_GRANTS=0) must FAIL against the historical loop'
  );
}

// ===========================================================================
// CASE_E_DEDICATED_MUTATION_PROOF — in-test model of the REJECTED shape.
//
// The rejected shape was:
//
//   1. grant transaction COMMIT
//   2. post-commit authority readback
//   3. allowed success audit, outside the commit unit
//
// Re-stating it on the same stub shows that an allowed-audit failure leaves the
// committed grants behind, which is exactly the state Case E rejects.
//
// Required observations:
//   MUTANT_API_FAILURE=YES
//   MUTANT_GRANTS_SURVIVE=YES
//   MUTANT_WILDCARD_SURVIVES=YES
//   MUTANT_GRANTED_AUDIT_SURVIVES=NO
// ===========================================================================
{
  const { sql, grants, auditEvents, stats } = makeSql({ failOnAllowedAudit: true });

  const grantWrites = SUPER_SCOPES.map((scope) => sql`
    insert into padiem_operator_grants (
      user_id, scope, status, granted_by_user_id, granted_at, reason, metadata
    ) values (
      ${SUPER_ACTOR_ID}::uuid,
      ${scope},
      'active',
      ${null},
      now(),
      'pre-registered administrator bootstrap',
      ${'{}'}::jsonb
    )
    on conflict do nothing
  `);

  let mutantApiFailure = false;
  try {
    // 1. grants commit on their own — the historical `sql.transaction(grantWrites)`
    await sql.transaction(grantWrites);
    // 2. post-commit authority readback — the rejected extra failure mode
    await sql`
      select id, scope from padiem_operator_grants
      where user_id = ${SUPER_ACTOR_ID} and status = 'active'
      order by scope
    `;
    // 3. allowed success audit, deliberately outside the commit unit
    await sql`
      insert into audit_events (
        request_id, actor_user_id, actor_kind, complex_id, action, scope, decision, reason_code, metadata
      ) values (
        ${'req-mutant'},
        ${SUPER_ACTOR_ID},
        'user',
        ${null},
        'authorization.admin-bootstrap',
        'admin.bootstrap',
        ${'allowed'},
        ${'ADMIN_BOOTSTRAP_GRANTED'},
        ${'{}'}::jsonb
      )
    `;
  } catch {
    mutantApiFailure = true;
  }

  const surviving = scopesOf(grants);
  const grantedAuditSurvived = auditEvents.some((e) => e.reasonCode === 'ADMIN_BOOTSTRAP_GRANTED');

  assert.equal(mutantApiFailure, true, 'MUTANT_API_FAILURE=YES');
  assert.equal(surviving.length > 0, true, 'MUTANT_GRANTS_SURVIVE=YES');
  assert.equal(surviving.includes('*'), true, 'MUTANT_WILDCARD_SURVIVES=YES');
  assert.equal(grantedAuditSurvived, false, 'MUTANT_GRANTED_AUDIT_SURVIVES=NO');
  assert.equal(
    stats.queriesAfterSuccessfulTransaction > 0,
    true,
    'the rejected shape issues post-commit database operations, which is the extra 503 failure mode the fix removes'
  );
  // Case E's acceptance rule must reject exactly this state.
  assert.equal(
    surviving.length === 0,
    false,
    'Case E acceptance (NEW_ACTIVE_GRANTS=0) must FAIL against the rejected shape'
  );
}

// ===========================================================================
// ASSERTION_SHAPE_MUTATION_PROOF — why the assertion must not use `nullif`.
//
// `sum(missing) / nullif(sum(missing), 0)` never raises: `nullif(x, 0)` yields
// NULL, and `x / NULL` is NULL rather than an error, so that shape has no path
// to a zero divisor and the assertion silently becomes a no-op — an authority
// that cannot be established would then be reported as established.
//
// This states the arithmetic of both shapes explicitly. The static guard that
// keeps the shipped source out of the rejected shape lives in
// admin-bootstrap-contract.mjs; a live-Postgres assertion is out of scope here.
// ===========================================================================
{
  const nullif = (value, fallback) => (value === fallback ? null : value);
  const rejectedShapeHasZeroDivisor = (missing) => nullif(missing, 0) === 0;

  assert.equal(rejectedShapeHasZeroDivisor(0), false, 'the rejected shape must not divide by zero when the check passes');
  assert.equal(
    rejectedShapeHasZeroDivisor(1),
    false,
    'ASSERTION_SHAPE_MUTATION_PROOF: the rejected nullif shape has no zero divisor, so a failed check would still commit the grants'
  );

  // The shipped shape divides by 0 exactly when the check failed.
  const shippedDivisor = (expectedPresent, expectedCount, wildcardParityMatches) =>
    (expectedPresent === expectedCount && wildcardParityMatches ? 1 : 0);

  assert.equal(shippedDivisor(9, 9, true), 1, 'the shipped shape divides by 1 when the check passes');
  assert.equal(
    shippedDivisor(8, 9, true),
    0,
    'ASSERTION_SHAPE_MUTATION_PROOF: the shipped shape divides by zero — and so aborts — when a scope is missing'
  );
  assert.equal(
    shippedDivisor(9, 9, false),
    0,
    'ASSERTION_SHAPE_MUTATION_PROOF: the shipped shape aborts on a wildcard-parity mismatch too'
  );
}

console.log('admin-bootstrap-atomicity-1046: PASS');
