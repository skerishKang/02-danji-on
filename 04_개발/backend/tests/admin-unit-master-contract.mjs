import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleAdminUnitMasterWithSql } from '../src/admin-unit-master-v1.ts';

const root = new URL('../', import.meta.url);
const [api, app, adminBridge, adminPage, migration055, ledger, residentMaster] = await Promise.all([
  readFile(new URL('src/admin-unit-master-v1.ts', root), 'utf8'),
  readFile(new URL('src/app.ts', root), 'utf8'),
  readFile(new URL('../../frontend/assets/danjion-admin-console.js', root), 'utf8'),
  readFile(new URL('../../frontend/admin/index.html', root), 'utf8'),
  readFile(new URL('migrations/055_complex_unit_master_provenance.sql', root), 'utf8'),
  readFile(new URL('migration-safety-ledger.json', root), 'utf8'),
  readFile(new URL('src/household-master-v2.ts', root), 'utf8')
]);

/* ================= 1. Source invariants ================= */

// Invariant 1: Single canonical source of truth - complex_units only (SECOND_UNIT_REGISTRY=NO)
assert.match(api, /from complex_units/, 'unit master must query canonical complex_units');
assert.match(api, /insert into complex_units/, 'unit master must write to canonical complex_units');
assert.match(api, /update complex_units/, 'unit master must update canonical complex_units');
assert.doesNotMatch(api, /create table (?:if not exists )?unit_registry|create table (?:if not exists )?real_units/i,
  'must not create a duplicate unit registry table (SECOND_UNIT_REGISTRY=NO)');

// Invariant 1b: Atomic CTE mutation + audit coupling
assert.match(api, /with inserted as \([\s\S]*?insert into complex_units[\s\S]*?\), audited as \([\s\S]*?insert into audit_events[\s\S]*?\)[\s\S]*?select[\s\S]*?from inserted[\s\S]*?join audited on true/s,
  'POST must couple unit insert and audit insert atomically in a single CTE');
assert.match(api, /with changed as \([\s\S]*?update complex_units[\s\S]*?\), audited as \([\s\S]*?insert into audit_events[\s\S]*?\)[\s\S]*?select[\s\S]*?from changed[\s\S]*?join audited on true/s,
  'PATCH must couple unit update and audit insert atomically in a single CTE');


// Invariant 2: Minimal operator provenance without resident PII (RESIDENT_PII_IN_UNIT_MASTER=NO)
assert.match(migration055, /add column if not exists created_by_user_id uuid/i);
assert.match(migration055, /add column if not exists updated_by_user_id uuid/i);
assert.match(migration055, /add column if not exists deactivated_at timestamptz/i);
const sqlWithoutComments = migration055.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(sqlWithoutComments, /resident|name|phone|email|roster|ssn/i,
  'migration 055 must not introduce any resident PII columns (RESIDENT_PII_IN_UNIT_MASTER=NO)');
assert.doesNotMatch(api, /resident_name|phone_number|resident_email|resident_roster/i,
  'unit master API must never query or expose resident PII');

// Invariant 3: Ledger registration
const parsedLedger = JSON.parse(ledger);
const ledgerEntry = parsedLedger.migrations['055_complex_unit_master_provenance.sql'];
assert.ok(ledgerEntry,
  '055 migration must be tracked in migration-safety-ledger.json');
assert.equal(ledgerEntry.class, 'schema');
assert.equal(ledgerEntry.marker?.table, 'complex_units');
assert.equal(ledgerEntry.marker?.name, 'deactivated_at');

// Invariant 4: No hard delete (UNIT_HARD_DELETE=NO)
assert.match(api, /request\.method === 'DELETE'[\s\S]*?405/s,
  'DELETE must fail closed with 405 Method Not Allowed');
assert.doesNotMatch(api, /delete from complex_units/i,
  'must never issue DELETE against complex_units (UNIT_HARD_DELETE=NO)');

// Invariant 5: Authority & scope binding (NEW_OPERATOR_SCOPE=NO, COUNCIL_AUTHORITY_WIDENING=NO)
assert.match(api, /const SCOPE = 'resident\.verification\.manage'/,
  'unit master must reuse existing resident.verification.manage scope');
assert.match(api, /resolvePadiemAuthority/,
  'unit master must resolve authority via PADIEM authority plane');
assert.doesNotMatch(api, /requireOperationalAuthority|complex_operator_grants|resident_council/i,
  'must not widen to complex/council operational authority (COUNCIL_AUTHORITY_WIDENING=NO)');

// Invariant 6: Audit actions
assert.match(api, /'unit-master\.create'/, 'must log unit-master.create audit event');
assert.match(api, /'unit-master\.update'/, 'must log unit-master.update audit event');
assert.match(api, /'unit-master\.status'/, 'must log unit-master.status audit event');

// Invariant 7: App routing
assert.match(app, /handleAdminUnitMasterRequest/);
assert.ok(
  app.indexOf('handleAdminUnitMasterRequest(request, env, id)') <
    app.indexOf('handleAdminRequest(request, env, id)'),
  'unit master handler must intercept before terminal admin fallback'
);

// Invariant 8: Console bridge & index.html
assert.match(adminBridge, /id: 'unitMaster'/);
assert.match(adminBridge, /requiredScope: 'resident\.verification\.manage'/);
assert.match(adminBridge, /createUnitMaster/);
assert.match(adminBridge, /updateUnitMaster/);
assert.match(adminPage, /function unitMasterComposer/);
assert.match(adminPage, /function unitMasterControls/);

// Invariant 9: Resident onboarding picker reads active units only
assert.match(residentMaster, /status = 'active'/,
  'resident-facing household master query must filter by status = active');

/* ================= 2. Dynamic runtime handler execution ================= */

const testEnv = {
  DATABASE_URL: 'postgres://mock-db',
  DEV_AUTH_BYPASS: 'true',
  APP_ENV: 'test'
};
const requestId = 'req-test-unit-master';
const complexId = '11111111-1111-4111-8111-111111111111';
const unitId1 = '22222222-2222-4222-8222-222222222222';
const operatorUserId = '99999999-9999-4999-8999-999999999999';

function createMockSql(scenario = {}) {
  const auditRows = [];
  const unitsDb = scenario.initialUnits || [
    {
      id: unitId1,
      complex_id: complexId,
      building_code: '101',
      unit_code: '101',
      status: 'active',
      created_by_user_id: operatorUserId,
      updated_by_user_id: operatorUserId,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      deactivated_at: null
    }
  ];

  const mockSql = async (strings, ...values) => {
    const query = strings.join('?').trim();

    // App users query for devActor
    if (query.includes('from app_users')) {
      return [{
        id: operatorUserId,
        auth_user_id: 'sub-operator',
        display_name: '운영자',
        account_status: 'active'
      }];
    }

    // Authority queries
    if (query.includes('padiem_operator_grants')) {
      if (scenario.noAuthority) return [];
      if (scenario.wildcard) return [{ id: 'g-wildcard', scope: '*' }];
      const scopes = scenario.scopes ?? ['resident.verification.manage'];
      return scopes.map((scope, idx) => ({ id: `grant-${idx}`, scope }));
    }
    if (query.includes('padiem_authority_decisions')) {
      return [{ id: 'dec-1' }];
    }
    // Atomic POST CTE: with inserted as (insert into complex_units ...), audited as (insert into audit_events ...)
    if (query.includes('with inserted as')) {
      if (scenario.failAuditOnCreate || scenario.failAudit) {
        throw new Error('INJECTED_AUDIT_FAILURE: create audit insert failed in CTE');
      }
      const [cId, bCode, uCode, cActorId, uActorId, rId, aActorId, scope, metaStr] = values;
      const newUnit = {
        id: '33333333-3333-4333-8333-333333333333',
        complex_id: cId || complexId,
        building_code: bCode,
        unit_code: uCode,
        status: 'active',
        created_by_user_id: cActorId,
        updated_by_user_id: uActorId,
        created_at: new Date('2026-09-19T00:00:00Z'),
        updated_at: new Date('2026-09-19T00:00:00Z'),
        deactivated_at: null
      };
      unitsDb.push(newUnit);
      auditRows.push({
        query,
        values: [rId, aActorId, 'operator', cId, 'unit-master.create', scope, 'complex_unit', newUnit.id, 'recorded', metaStr],
        action: 'unit-master.create',
        metadata: JSON.parse(metaStr || '{}')
      });
      return [newUnit];
    }

    // Atomic PATCH CTE: with changed as (update complex_units ...), audited as (insert into audit_events ...)
    if (query.includes('with changed as')) {
      if (scenario.failAuditOnUpdate || scenario.failAudit) {
        throw new Error('INJECTED_AUDIT_FAILURE: update audit insert failed in CTE');
      }
      const [targetB, targetU, targetS, deactAt, uActorId, uId, rId, aActorId, auditAct, scope, metaStr] = values;
      const match = unitsDb.find((u) => u.id === uId);
      if (match) {
        match.building_code = targetB;
        match.unit_code = targetU;
        match.status = targetS;
        match.deactivated_at = deactAt ? new Date(deactAt) : null;
        match.updated_by_user_id = uActorId;
        match.updated_at = new Date('2026-09-19T01:00:00Z');
        auditRows.push({
          query,
          values: [rId, aActorId, 'operator', match.complex_id, auditAct, scope, 'complex_unit', match.id, 'recorded', metaStr],
          action: auditAct,
          metadata: JSON.parse(metaStr || '{}')
        });
        return [match];
      }
      return [];
    }

    if (query.includes('audit_events')) {
      auditRows.push({ query, values, action: 'authorization.padiem-authority-check' });
      return [{ id: 'audit-1' }];
    }

    // Complexes query
    if (query.includes('from complexes')) {
      const slugVal = values[0];
      if (slugVal === 'banglim-myeongji-roadhill') {
        return [{ id: complexId, slug: 'banglim-myeongji-roadhill', name: '방림명지로드힐' }];
      }
      return [];
    }

    // Complex_units list query
    if (query.startsWith('select id, building_code, unit_code, status, created_at, updated_at, deactivated_at\n          from complex_units')) {
      let filtered = [...unitsDb];
      if (query.includes("and status = 'active'")) {
        filtered = filtered.filter((u) => u.status === 'active');
      } else if (query.includes("and status = 'inactive'")) {
        filtered = filtered.filter((u) => u.status === 'inactive');
      }
      return filtered;
    }

    // Duplicate check on create
    if (query.startsWith('select id\n        from complex_units\n        where complex_id = ?::uuid\n          and building_code = ?\n          and unit_code = ?\n        limit 1')) {
      const [, bCode, uCode] = values;
      const match = unitsDb.find((u) => u.building_code === bCode && u.unit_code === uCode);
      return match ? [{ id: match.id }] : [];
    }

    // Select single unit by ID
    if (query.startsWith('select id, complex_id, building_code, unit_code, status, deactivated_at\n      from complex_units\n      where id = ?::uuid')) {
      const [uId] = values;
      const match = unitsDb.find((u) => u.id === uId);
      return match ? [match] : [];
    }

    // Duplicate check on update
    if (query.startsWith('select id\n        from complex_units\n        where complex_id = ?::uuid\n          and building_code = ?\n          and unit_code = ?\n          and id <> ?::uuid')) {
      const [, bCode, uCode, uId] = values;
      const match = unitsDb.find((u) => u.building_code === bCode && u.unit_code === uCode && u.id !== uId);
      return match ? [{ id: match.id }] : [];
    }

    return [];
  };

  mockSql.auditRows = auditRows;
  mockSql.unitsDb = unitsDb;
  return mockSql;
}

function authHeaders(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-danjion-dev-auth-user': 'sub-operator',
    ...extra
  };
}

// Test 1: 401 unauthenticated
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'GET'
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 401, 'unauthenticated call must return 401');
}

// Test 2: 403 missing scope
{
  const sql = createMockSql({ scopes: ['business.review'] });
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'GET',
    headers: authHeaders()
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 403, 'call without resident.verification.manage must return 403');
}

// Test 3: 200 GET list units (all, active, inactive)
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master?status=all', {
    method: 'GET',
    headers: authHeaders()
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 200);
  const json = await res?.json();
  assert.equal(json.data.complex.slug, 'banglim-myeongji-roadhill');
  assert.equal(json.data.units.length, 1);
  assert.equal(json.data.units[0].buildingCode, '101');
  assert.equal(json.data.units[0].unitCode, '101');
  assert.equal(json.data.units[0].status, 'active');
  assert.equal(json.data.units[0].deactivatedAt, null);
  // Ensure no resident PII in payload
  assert.equal(json.data.units[0].residentName, undefined);
  assert.equal(json.data.units[0].phoneNumber, undefined);
}

// Test 4: 201 POST create new unit + audit event logged
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '102', unitCode: '201' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 201);
  const json = await res?.json();
  assert.equal(json.data.unit.buildingCode, '102');
  assert.equal(json.data.unit.unitCode, '201');
  assert.equal(json.data.unit.status, 'active');
  assert.ok(sql.auditRows.some((r) => r.query.includes('unit-master.create') || r.values.includes('unit-master.create')),
    'audit action unit-master.create must be recorded');
  assert.equal(sql.auditRows.filter((r) => r.action === 'unit-master.create').length, 1,
    'successful create must record exactly 1 unit-master.create audit row');
}

// Test 5: 409 POST duplicate unit
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '101', unitCode: '101' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 409);
  const json = await res?.json();
  assert.equal(json.error.code, 'UNIT_ALREADY_EXISTS');
}

// Test 6: 400 POST validation errors
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '101' }) // missing unitCode
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 400);
}

// Test 7: 405 DELETE fails closed
{
  const sql = createMockSql();
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'DELETE',
    headers: authHeaders()
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 405, 'DELETE must fail closed with 405');
}

// Test 8: 200 PATCH update unit codes + audit event logged
{
  const sql = createMockSql();
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '101', unitCode: '102' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 200);
  const json = await res?.json();
  assert.equal(json.data.unit.unitCode, '102');
  assert.ok(sql.auditRows.some((r) => r.query.includes('unit-master.update') || r.values.includes('unit-master.update')),
    'audit action unit-master.update must be recorded');
  assert.equal(sql.auditRows.filter((r) => r.action === 'unit-master.update').length, 1,
    'successful code update must record exactly 1 unit-master.update audit row');
}

// Test 9: 200 PATCH deactivate unit (status -> inactive) + audit event logged
{
  const sql = createMockSql();
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'inactive' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 200);
  const json = await res?.json();
  assert.equal(json.data.unit.id, unitId1, 'UUID must remain identical on deactivation');
  assert.equal(json.data.unit.status, 'inactive');
  assert.ok(json.data.unit.deactivatedAt !== null, 'deactivatedAt must be set');
  assert.ok(sql.auditRows.some((r) => r.query.includes('unit-master.status') || r.values.includes('unit-master.status')),
    'audit action unit-master.status must be recorded');
  assert.equal(sql.auditRows.filter((r) => r.action === 'unit-master.status').length, 1,
    'successful status transition must record exactly 1 unit-master.status audit row');
}

// Test 10: 200 PATCH reactivate unit (status -> active) + deactivated_at cleared
{
  const deactivatedUnit = {
    id: unitId1,
    complex_id: complexId,
    building_code: '101',
    unit_code: '101',
    status: 'inactive',
    created_by_user_id: operatorUserId,
    updated_by_user_id: operatorUserId,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    deactivated_at: new Date('2026-09-01T00:00:00Z')
  };
  const sql = createMockSql({ initialUnits: [deactivatedUnit] });
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'active' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 200);
  const json = await res?.json();
  assert.equal(json.data.unit.id, unitId1, 'UUID must remain identical on reactivation');
  assert.equal(json.data.unit.status, 'active');
  assert.equal(json.data.unit.deactivatedAt, null, 'deactivatedAt must be cleared to null');
  assert.ok(sql.auditRows.some((r) => r.query.includes('unit-master.status') || r.values.includes('unit-master.status')),
    'audit action unit-master.status must be recorded');
}

// Test 11: 405 PATCH on unit list or DELETE on single unit
{
  const sql = createMockSql();
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 405, 'DELETE on complex-units/:unitId must fail closed with 405');
}

// Test 12: Injected audit failure on create -> unit row NOT inserted (atomic CTE rollback)
{
  const sql = createMockSql({ failAuditOnCreate: true });
  const initialCount = sql.unitsDb.length;
  const req = new Request('http://localhost/api/v1/admin/complexes/banglim-myeongji-roadhill/unit-master', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '999', unitCode: '999' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 500, 'forced audit failure on create must return 500');
  const json = await res?.json();
  assert.equal(json.error.code, 'DATABASE_ERROR');
  assert.equal(sql.unitsDb.length, initialCount, 'unit must NOT be inserted when audit fails');
  assert.ok(!sql.unitsDb.some((u) => u.building_code === '999' && u.unit_code === '999'), 'unit 999-999 must not exist');
  assert.equal(sql.auditRows.filter((r) => r.action?.startsWith('unit-master.')).length, 0, 'no unit-master audit rows must be recorded when CTE aborts');
}

// Test 13: Injected audit failure on code update -> unit code unchanged (atomic CTE rollback)
{
  const sql = createMockSql({ failAuditOnUpdate: true });
  const originalUnit = { ...sql.unitsDb.find((u) => u.id === unitId1) };
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ buildingCode: '101', unitCode: '888' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 500, 'forced audit failure on update must return 500');
  const json = await res?.json();
  assert.equal(json.error.code, 'DATABASE_ERROR');
  const currentUnit = sql.unitsDb.find((u) => u.id === unitId1);
  assert.equal(currentUnit.unit_code, originalUnit.unit_code, 'unitCode must remain unchanged when audit fails');
  assert.equal(currentUnit.building_code, originalUnit.building_code, 'buildingCode must remain unchanged when audit fails');
  assert.equal(sql.auditRows.filter((r) => r.action?.startsWith('unit-master.')).length, 0, 'no unit-master audit rows must be recorded when CTE aborts');
}

// Test 14: Injected audit failure on status toggle -> unit status unchanged (atomic CTE rollback)
{
  const sql = createMockSql({ failAuditOnUpdate: true });
  const originalUnit = { ...sql.unitsDb.find((u) => u.id === unitId1) };
  const req = new Request(`http://localhost/api/v1/admin/complex-units/${unitId1}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'inactive' })
  });
  const res = await handleAdminUnitMasterWithSql(req, testEnv, sql, requestId);
  assert.equal(res?.status, 500, 'forced audit failure on status toggle must return 500');
  const json = await res?.json();
  assert.equal(json.error.code, 'DATABASE_ERROR');
  const currentUnit = sql.unitsDb.find((u) => u.id === unitId1);
  assert.equal(currentUnit.status, originalUnit.status, 'status must remain unchanged when audit fails');
  assert.equal(currentUnit.deactivated_at, originalUnit.deactivated_at, 'deactivated_at must remain unchanged');
  assert.equal(sql.auditRows.filter((r) => r.action?.startsWith('unit-master.')).length, 0, 'no unit-master audit rows must be recorded when CTE aborts');
}

console.log('PASS #776 authoritative unit master and bounded admin console management contract');

