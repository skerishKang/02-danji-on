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
    if (query.includes('audit_events')) {
      auditRows.push({ query, values });
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

    // Insert unit
    if (query.startsWith('insert into complex_units')) {
      const [, bCode, uCode, , actorId] = values;
      const newUnit = {
        id: '33333333-3333-4333-8333-333333333333',
        complex_id: complexId,
        building_code: bCode,
        unit_code: uCode,
        status: 'active',
        created_by_user_id: actorId,
        updated_by_user_id: actorId,
        created_at: new Date('2026-09-19T00:00:00Z'),
        updated_at: new Date('2026-09-19T00:00:00Z'),
        deactivated_at: null
      };
      unitsDb.push(newUnit);
      return [newUnit];
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

    // Update unit
    if (query.startsWith('update complex_units')) {
      const [targetB, targetU, targetS, deactAt, actorId, uId] = values;
      const match = unitsDb.find((u) => u.id === uId);
      if (match) {
        match.building_code = targetB;
        match.unit_code = targetU;
        match.status = targetS;
        match.deactivated_at = deactAt ? new Date(deactAt) : null;
        match.updated_by_user_id = actorId;
        match.updated_at = new Date('2026-09-19T01:00:00Z');
        return [match];
      }
      return [];
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

console.log('PASS #776 authoritative unit master and bounded admin console management contract');
