// #1046: administrator grant bootstrap must be atomic across all runtime scopes.
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
// The fix collects the whole write set and commits it with one
// `sql.transaction(...)`, the pattern already used by resident-profile-v1.
//
// This contract is behavioural: it runs the real handler and models real
// transaction commit/rollback semantics in the stub. A bare `throw new Error()`
// with no state tracking would not prove anything about surviving rows.
//
//   Case A  SUPER mid-loop failure       -> no new grant survives, no wildcard
//   Case B  OPERATIONAL mid-loop failure -> no partial bounded grants
//   Case C  success parity               -> SUPER and OPERATIONAL
//   Case D  idempotent re-bootstrap      -> no duplicates, authority unchanged
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

const actorsBySubject = new Map([
  ['sub-super', { id: '00000000-0000-4000-8000-000000000201', auth_user_id: 'ba-super', display_name: 'Super' }],
  ['sub-operational', { id: '00000000-0000-4000-8000-000000000202', auth_user_id: 'ba-op', display_name: 'Op' }]
]);

const principalByActor = new Map([
  ['00000000-0000-4000-8000-000000000201', {
    id: '10000000-0000-0000-8000-000000000001',
    provider: 'google',
    authority_level: 'admin',
    scopes: ['*']
  }],
  ['00000000-0000-4000-8000-000000000202', {
    id: '10000000-0000-0000-8000-000000000002',
    provider: 'google',
    authority_level: 'operator',
    // The allowlist row must satisfy isCanonicalPrincipalScopes, so it carries the
    // full bounded bundle from the real policy rather than a hand-picked subset.
    scopes: principalScopesForRole('operator')
  }]
]);

/**
 * A SQL stub that models an actual transaction boundary.
 *
 * Writes executed outside a transaction commit immediately. Writes executed
 * inside `sql.transaction([...])` are staged and only applied to the grant store
 * when the whole set succeeds; if any statement throws, nothing is applied.
 */
function makeSql({ runtimeScopes, failOnScope = null, existingGrants = [] }) {
  const grants = new Map();
  for (const scope of existingGrants) grants.set(scope, { id: 'seed-' + scope, scope, status: 'active' });
  const auditEvents = [];
  const stats = { transactions: 0, committedWrites: 0, rolledBackWrites: 0, directWrites: 0 };

  // Applies one write's effect, used both for direct execution and for the
  // commit of a staged transaction.
  const applyGrantWrite = (strings, values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!query.startsWith('insert into padiem_operator_grants')) return false;
    const scope = String(values[1]);
    // `on conflict do nothing`: an existing grant is left exactly as it is.
    if (grants.has(scope)) return true;
    grants.set(scope, { id: 'g-' + scope, scope, status: 'active' });
    return true;
  };

  async function runQuery(strings, values) {
    const query = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();

    if (query.includes('join padiem_admin_identity_allowlist p')) {
      const principal = principalByActor.get(String(values[0]));
      return principal ? [principal] : [];
    }

    if (query.includes('from app_users') && !query.includes('padiem_admin_identity_allowlist')) {
      const actor = actorsBySubject.get(String(values[0]));
      return actor ? [actor] : [];
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

    if (query.includes('from padiem_operator_grants')) {
      const actorId = String(values[0]);
      return [...grants.values()]
        .filter((g) => g.status === 'active')
        .sort((a, b) => a.scope.localeCompare(b.scope))
        .map((g) => ({ id: g.id, scope: g.scope }));
    }

    if (query.startsWith('insert into audit_events')) {
      auditEvents.push({
        decision: String(values[3]),
        reasonCode: String(values[4]),
        metadata: JSON.parse(String(values[5]))
      });
      return [];
    }

    throw new Error('Unexpected SQL in atomicity test: ' + query);
  }

  // Mirrors the real neon query function: calling `sql` returns a *thunk* that
  // executes the query when invoked. `sql.transaction([...])` receives those
  // thunks and runs them as one unit. If `sql` executed eagerly instead, the
  // test could never observe transaction semantics at all.
  // A thenable thunk: awaiting it runs the query immediately (so the source's
  // `await sql`...`` reads work), while `sql.transaction([...])` holds the same
  // object and invokes it later inside the transaction boundary.
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
  // The page must use a real transaction boundary. This is the real shape of
  // `neon(...).transaction`: it receives the array of query functions and runs
  // them as one unit.
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
      return results;
    } catch (err) {
      grants.clear();
      for (const [k, v] of snapshot) grants.set(k, v);
      stats.rolledBackWrites += queries.length;
      throw err;
    }
  };
  void runtimeScopes;
  return { sql, grants, auditEvents, stats };
}

const request = (subject) =>
  new Request('https://danjion.test/api/v1/admin/bootstrap', {
    method: 'POST',
    headers: { 'x-danjion-dev-auth-user': subject }
  });

const scopesOf = (grants) => [...grants.values()].filter((g) => g.status === 'active').map((g) => g.scope).sort();

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
  assert.equal(stats.rolledBackWrites, SUPER_SCOPES.length, 'Case A: the whole write set must roll back');
  assert.equal(SUPER_SCOPES.length, runtimeScopesForRole('admin').length, 'Case A: the write set must be exactly the admin runtime scopes');
  assert.equal(stats.committedWrites, 0, 'Case A: no write from the failed attempt may commit');

  const active = scopesOf(grants);
  assert.deepEqual(active, [], 'Case A: no new grant may survive the failed bootstrap');
  assert.equal(grants.has('*'), false, 'Case A: the wildcard must not remain active after a failed bootstrap');
  assert.equal(
    active.some((s) => SUPER_SCOPES.includes(s)),
    false,
    'Case A: no partial scope may remain active',
  );

  // Audit must stay truthful: the attempt failed, so it must not claim granted.
  const last = auditEvents.at(-1);
  assert.equal(last.decision, 'denied', 'Case A: a failed bootstrap must audit as denied');
  assert.equal(last.reasonCode, 'ADMIN_BOOTSTRAP_DATABASE_ERROR');
  assert.equal(
    auditEvents.some((e) => e.reasonCode === 'ADMIN_BOOTSTRAP_GRANTED'),
    false,
    'Case A: a rolled-back bootstrap must never audit ADMIN_BOOTSTRAP_GRANTED',
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
  assert.equal(stats.rolledBackWrites, OPERATIONAL_SCOPES.length, 'Case B: the whole bounded write set must roll back');
  assert.deepEqual(scopesOf(grants), [], 'Case B: no partial bounded grant may remain active');
  assert.equal(grants.has('*'), false, 'Case B: an OPERATIONAL bootstrap must never grant the wildcard');
  const last = auditEvents.at(-1);
  assert.equal(last.reasonCode, 'ADMIN_BOOTSTRAP_DATABASE_ERROR', 'Case B: audit must describe the real failure');
}

// ===========================================================================
// Case C — success parity. SUPER gets the wildcard plus every bounded scope;
// OPERATIONAL gets exactly its bounded scopes and no wildcard.
// ===========================================================================
{
  const { sql, grants, auditEvents, stats } = makeSql({ failOnScope: null });

  const response = await bootstrapAdminAuthorityResponse(request('sub-super'), env, sql, 'req-c1');
  const body = await response.json();

  assert.equal(response.status, 200, 'Case C: a successful SUPER bootstrap must return 200');
  assert.equal(stats.transactions, 1);
  assert.equal(stats.rolledBackWrites, 0, 'Case C: a success must not roll anything back');
  assert.deepEqual(scopesOf(grants), [...SUPER_SCOPES].sort(), 'Case C: SUPER must hold the wildcard and every expected scope');
  assert.equal(grants.has('*'), true, 'Case C: SUPER must hold the wildcard');
  assert.equal(body.data.wildcard, true, 'Case C: SUPER readback must report the wildcard');
  const superAudit = auditEvents.at(-1);
  assert.equal(superAudit.decision, 'allowed');
  assert.equal(superAudit.reasonCode, 'ADMIN_BOOTSTRAP_GRANTED');
  assert.equal(superAudit.metadata.scopeCount, SUPER_SCOPES.length, 'Case C: the allowed audit must describe the real scope count');

  const op = makeSql({ failOnScope: null });
  const opResponse = await bootstrapAdminAuthorityResponse(request('sub-operational'), env, op.sql, 'req-c2');
  const opBody = await opResponse.json();
  assert.equal(opResponse.status, 200, 'Case C: a successful OPERATIONAL bootstrap must return 200');
  assert.deepEqual(scopesOf(op.grants), [...OPERATIONAL_SCOPES].sort(), 'Case C: OPERATIONAL must hold exactly its bounded scopes');
  assert.equal(op.grants.has('*'), false, 'Case C: OPERATIONAL must never receive the wildcard');
  assert.equal(opBody.data.wildcard, false, 'Case C: OPERATIONAL readback must not report a wildcard');
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
    'Case D: re-bootstrap must not create a duplicate wildcard grant',
  );
  assert.equal(
    [...grants.values()].length,
    before.length,
    'Case D: re-bootstrap must not add any grant row',
  );
  assert.equal(body.data.wildcard, true, 'Case D: re-bootstrap must report the same authority');
  assert.equal(auditEvents.at(-1).reasonCode, 'ADMIN_BOOTSTRAP_GRANTED', 'Case D: a successful re-bootstrap audits as granted');
}

// ===========================================================================
// Mutation proof — re-injecting the historical per-scope loop (no transaction
// boundary) must break the mid-loop failure cases.
// ===========================================================================
{
  const sourceUrl = new URL('../src/admin-bootstrap-v1.ts', import.meta.url);
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(sourceUrl, 'utf8');

  assert.ok(
    source.includes('await sql.transaction(grantWrites);'),
    'the fix must commit the grant write set through one transaction boundary',
  );
  assert.doesNotMatch(
    source,
    /for \(const scope of runtimeScopes\)\s*\{\s*await sql`/,
    'the historical per-scope independent-write loop must be gone',
  );

  // Simulate the historical implementation against the same stub semantics:
  // each insert commits on its own, so an earlier wildcard survives the failure.
  const { sql, grants } = makeSql({ failOnScope: FAIL_SCOPE });
  const staged = [];
  for (const scope of SUPER_SCOPES) {
    staged.push(() => sql`insert into padiem_operator_grants (user_id, scope, status, granted_by_user_id, granted_at, reason, metadata) values (${'x'}::uuid, ${scope}, 'active', ${null}, now(), 'pre-registered administrator bootstrap', ${'{}'}::jsonb) on conflict do nothing`);
  }
  let threw = false;
  for (const write of staged) {
    try {
      await write().run();
    } catch {
      threw = true;
      break;
    }
  }
  assert.equal(threw, true, 'mutation: the historical loop must hit the injected failure');
  assert.equal(
    grants.has('*'),
    true,
    'mutation: the historical loop leaves the wildcard committed — this is exactly the partial-grant defect the transaction prevents',
  );
  assert.ok(
    scopesOf(grants).length > 0,
    'mutation: the historical loop leaves partial grants behind',
  );
}

console.log('admin-bootstrap-atomicity-1046: PASS');
