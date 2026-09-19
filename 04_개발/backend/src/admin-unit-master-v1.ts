import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor, type AuthEnv } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { recordAuthorityDecision, resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;
export type AdminUnitMasterEnv = CoreEnv & AuthEnv;

const SCOPE = 'resident.verification.manage';
const MAX_BODY_BYTES = 4 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIT_PART = /^[0-9A-Za-z가-힣-]{1,20}$/;
const REQUEST_ID_HEADER = 'x-danjion-request-id';

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'access-control-expose-headers': REQUEST_ID_HEADER,
      'cache-control': 'no-store'
    }
  });
}

function ok(data: unknown, requestId: string, status = 200): Response {
  return json({ data, requestId }, status, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: AdminUnitMasterEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function decodeSlug(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return SLUG.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function unitPart(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return UNIT_PART.test(text) ? text : null;
}

export async function requirePadiemUnitMasterAuthority(
  request: Request,
  env: AdminUnitMasterEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    const grantedScope = authority.wildcard ? '*' : authority.scopes.includes(SCOPE) ? SCOPE : null;
    if (!grantedScope) {
      await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'UNIT_MASTER_SCOPE_MISSING', null);
      return fail('UNIT_MASTER_FORBIDDEN', 'PADIEM unit master authority required', 403, requestId);
    }

    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'allowed',
      authority.wildcard ? 'UNIT_MASTER_WILDCARD_GRANTED' : 'UNIT_MASTER_SCOPE_GRANTED',
      grantedScope
    );
    return actor;
  } catch {
    await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'UNIT_MASTER_AUTHORITY_DB_ERROR', null).catch(() => {});
    return fail('UNIT_MASTER_AUTHORITY_UNAVAILABLE', 'Unit master authority could not be verified', 503, requestId);
  }
}

async function parseJsonBody(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }
  return parsed as Record<string, unknown>;
}

export async function handleAdminUnitMasterWithSql(
  request: Request,
  env: AdminUnitMasterEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  // 1. List / Create: /api/v1/admin/complexes/:slug/unit-master
  const listMatch = url.pathname.match(/^\/api\/v1\/admin\/complexes\/([^/]+)\/unit-master$/);
  if (listMatch) {
    const complexSlug = decodeSlug(listMatch[1]);
    if (!complexSlug) return fail('INVALID_COMPLEX_SLUG', 'Invalid complex slug', 400, requestId);

    if (request.method === 'GET') {
      const actorOrResponse = await requirePadiemUnitMasterAuthority(request, env, sql, requestId);
      if (actorOrResponse instanceof Response) return actorOrResponse;

      const statusParam = (url.searchParams.get('status') || 'all').trim().toLowerCase();
      if (!['all', 'active', 'inactive'].includes(statusParam)) {
        return fail('INVALID_STATUS_FILTER', 'status must be all, active, or inactive', 400, requestId);
      }

      const complexes = await sql`
        select id, slug, name
        from complexes
        where slug = ${complexSlug}
        limit 1
      `;
      const complex = complexes[0];
      if (!complex) return fail('COMPLEX_NOT_FOUND', 'Complex not found', 404, requestId);

      let rows: any[];
      if (statusParam === 'active') {
        rows = await sql`
          select id, building_code, unit_code, status, created_at, updated_at, deactivated_at
          from complex_units
          where complex_id = ${String(complex.id)}::uuid
            and status = 'active'
          order by building_code asc, unit_code asc
        `;
      } else if (statusParam === 'inactive') {
        rows = await sql`
          select id, building_code, unit_code, status, created_at, updated_at, deactivated_at
          from complex_units
          where complex_id = ${String(complex.id)}::uuid
            and status = 'inactive'
          order by building_code asc, unit_code asc
        `;
      } else {
        rows = await sql`
          select id, building_code, unit_code, status, created_at, updated_at, deactivated_at
          from complex_units
          where complex_id = ${String(complex.id)}::uuid
          order by building_code asc, unit_code asc
        `;
      }

      return ok({
        complex: { id: String(complex.id), slug: String(complex.slug), name: String(complex.name) },
        units: rows.map((row) => ({
          id: String(row.id),
          buildingCode: String(row.building_code),
          unitCode: String(row.unit_code),
          status: String(row.status),
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at).toISOString() : null
        }))
      }, requestId);
    }

    if (request.method === 'POST') {
      const actorOrResponse = await requirePadiemUnitMasterAuthority(request, env, sql, requestId);
      if (actorOrResponse instanceof Response) return actorOrResponse;
      const actor = actorOrResponse;

      const body = await parseJsonBody(request, requestId);
      if (body instanceof Response) return body;

      const keys = Object.keys(body);
      if (keys.some((k) => k !== 'buildingCode' && k !== 'unitCode')) {
        return fail('VALIDATION_ERROR', 'Only buildingCode and unitCode are accepted', 400, requestId);
      }

      const buildingCode = unitPart(body.buildingCode);
      const unitCode = unitPart(body.unitCode);
      if (!buildingCode || !unitCode) {
        return fail('VALIDATION_ERROR', 'Valid buildingCode and unitCode (1..20 chars) are required', 400, requestId);
      }

      const complexes = await sql`
        select id, slug, name
        from complexes
        where slug = ${complexSlug}
        limit 1
      `;
      const complex = complexes[0];
      if (!complex) return fail('COMPLEX_NOT_FOUND', 'Complex not found', 404, requestId);

      const existing = await sql`
        select id
        from complex_units
        where complex_id = ${String(complex.id)}::uuid
          and building_code = ${buildingCode}
          and unit_code = ${unitCode}
        limit 1
      `;
      if (existing[0]) {
        return fail('UNIT_ALREADY_EXISTS', 'Unit already exists in this complex', 409, requestId);
      }

      try {
        const rows = await sql`
          insert into complex_units (
            complex_id, building_code, unit_code, status,
            created_by_user_id, updated_by_user_id
          ) values (
            ${String(complex.id)}::uuid, ${buildingCode}, ${unitCode}, 'active',
            ${actor.id}::uuid, ${actor.id}::uuid
          )
          returning id, building_code, unit_code, status, created_at, updated_at, deactivated_at
        `;
        const unit = rows[0];

        // Audit insert must be committed; fail-closed if audit fails
        await sql`
          insert into audit_events (
            request_id, actor_user_id, actor_kind, complex_id, action, scope,
            resource_type, resource_id, decision, metadata
          ) values (
            ${requestId}, ${actor.id}::uuid, 'operator', ${String(complex.id)}::uuid,
            'unit-master.create', ${SCOPE},
            'complex_unit', ${String(unit.id)}, 'recorded',
            ${JSON.stringify({ buildingCode, unitCode, status: 'active' })}::jsonb
          )
        `;

        return ok({
          unit: {
            id: String(unit.id),
            buildingCode: String(unit.building_code),
            unitCode: String(unit.unit_code),
            status: String(unit.status),
            createdAt: new Date(unit.created_at).toISOString(),
            updatedAt: new Date(unit.updated_at).toISOString(),
            deactivatedAt: unit.deactivated_at ? new Date(unit.deactivated_at).toISOString() : null
          }
        }, requestId, 201);
      } catch (err: any) {
        if (err?.code === '23505') {
          return fail('UNIT_ALREADY_EXISTS', 'Unit already exists in this complex', 409, requestId);
        }
        throw err;
      }
    }

    if (request.method === 'DELETE') {
      return fail('METHOD_NOT_ALLOWED', 'Unit deletion is not supported; use PATCH to deactivate', 405, requestId);
    }

    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  // 2. Modify unit: /api/v1/admin/complex-units/:unitId
  const unitMatch = url.pathname.match(/^\/api\/v1\/admin\/complex-units\/([^/]+)$/);
  if (unitMatch) {
    const rawUnitId = unitMatch[1].trim();
    if (!UUID.test(rawUnitId)) return fail('INVALID_UNIT_ID', 'Invalid unit id', 400, requestId);

    if (request.method === 'DELETE') {
      return fail('METHOD_NOT_ALLOWED', 'Unit deletion is not supported; use PATCH to deactivate', 405, requestId);
    }
    if (request.method !== 'PATCH') {
      return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    }

    const actorOrResponse = await requirePadiemUnitMasterAuthority(request, env, sql, requestId);
    if (actorOrResponse instanceof Response) return actorOrResponse;
    const actor = actorOrResponse;

    const body = await parseJsonBody(request, requestId);
    if (body instanceof Response) return body;

    const keys = Object.keys(body);
    if (keys.some((k) => !['buildingCode', 'unitCode', 'status'].includes(k))) {
      return fail('VALIDATION_ERROR', 'Only buildingCode, unitCode, and status may be modified', 400, requestId);
    }
    if (keys.length === 0) {
      return fail('VALIDATION_ERROR', 'At least one field to update is required', 400, requestId);
    }

    let parsedBuilding: string | undefined = undefined;
    if ('buildingCode' in body) {
      const b = unitPart(body.buildingCode);
      if (!b) return fail('VALIDATION_ERROR', 'Valid buildingCode (1..20 chars) is required', 400, requestId);
      parsedBuilding = b;
    }

    let parsedUnit: string | undefined = undefined;
    if ('unitCode' in body) {
      const u = unitPart(body.unitCode);
      if (!u) return fail('VALIDATION_ERROR', 'Valid unitCode (1..20 chars) is required', 400, requestId);
      parsedUnit = u;
    }

    let parsedStatus: 'active' | 'inactive' | undefined = undefined;
    if ('status' in body) {
      const s = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
      if (s !== 'active' && s !== 'inactive') {
        return fail('VALIDATION_ERROR', 'status must be active or inactive', 400, requestId);
      }
      parsedStatus = s;
    }

    const units = await sql`
      select id, complex_id, building_code, unit_code, status, deactivated_at
      from complex_units
      where id = ${rawUnitId}::uuid
      limit 1
    `;
    const current = units[0];
    if (!current) return fail('UNIT_NOT_FOUND', 'Unit not found', 404, requestId);

    const targetBuilding = parsedBuilding !== undefined ? parsedBuilding : String(current.building_code);
    const targetUnit = parsedUnit !== undefined ? parsedUnit : String(current.unit_code);
    const targetStatus = parsedStatus !== undefined ? parsedStatus : String(current.status);

    const codeChanged = targetBuilding !== current.building_code || targetUnit !== current.unit_code;
    const statusChanged = targetStatus !== current.status;

    if (codeChanged) {
      const dup = await sql`
        select id
        from complex_units
        where complex_id = ${String(current.complex_id)}::uuid
          and building_code = ${targetBuilding}
          and unit_code = ${targetUnit}
          and id <> ${rawUnitId}::uuid
        limit 1
      `;
      if (dup[0]) {
        return fail('UNIT_ALREADY_EXISTS', 'Unit already exists in this complex', 409, requestId);
      }
    }

    let newDeactivatedAt: string | null = current.deactivated_at ? new Date(current.deactivated_at).toISOString() : null;
    if (statusChanged) {
      if (targetStatus === 'inactive') {
        newDeactivatedAt = new Date().toISOString();
      } else {
        newDeactivatedAt = null;
      }
    }

    try {
      const updatedRows = await sql`
        update complex_units
        set building_code = ${targetBuilding},
            unit_code = ${targetUnit},
            status = ${targetStatus},
            deactivated_at = ${newDeactivatedAt ? newDeactivatedAt : null},
            updated_by_user_id = ${actor.id}::uuid,
            updated_at = now()
        where id = ${rawUnitId}::uuid
        returning id, complex_id, building_code, unit_code, status, created_at, updated_at, deactivated_at
      `;
      const updated = updatedRows[0];

      // Audit action: status change gets unit-master.status, code update gets unit-master.update
      const auditAction = (statusChanged && !codeChanged) ? 'unit-master.status' : 'unit-master.update';
      const metadata: Record<string, unknown> = {
        previousBuildingCode: String(current.building_code),
        newBuildingCode: targetBuilding,
        previousUnitCode: String(current.unit_code),
        newUnitCode: targetUnit,
        previousStatus: String(current.status),
        newStatus: targetStatus
      };

      await sql`
        insert into audit_events (
          request_id, actor_user_id, actor_kind, complex_id, action, scope,
          resource_type, resource_id, decision, metadata
        ) values (
          ${requestId}, ${actor.id}::uuid, 'operator', ${String(current.complex_id)}::uuid,
          ${auditAction}, ${SCOPE},
          'complex_unit', ${rawUnitId}, 'recorded',
          ${JSON.stringify(metadata)}::jsonb
        )
      `;

      return ok({
        unit: {
          id: String(updated.id),
          buildingCode: String(updated.building_code),
          unitCode: String(updated.unit_code),
          status: String(updated.status),
          createdAt: new Date(updated.created_at).toISOString(),
          updatedAt: new Date(updated.updated_at).toISOString(),
          deactivatedAt: updated.deactivated_at ? new Date(updated.deactivated_at).toISOString() : null
        }
      }, requestId);
    } catch (err: any) {
      if (err?.code === '23505') {
        return fail('UNIT_ALREADY_EXISTS', 'Unit already exists in this complex', 409, requestId);
      }
      throw err;
    }
  }

  return null;
}

export async function handleAdminUnitMasterRequest(
  request: Request,
  env: AdminUnitMasterEnv,
  requestId: string
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (
    !/^\/api\/v1\/admin\/complexes\/[^/]+\/unit-master$/.test(pathname) &&
    !/^\/api\/v1\/admin\/complex-units\/[^/]+$/.test(pathname)
  ) {
    return null;
  }
  return handleAdminUnitMasterWithSql(request, env, sqlFor(env), requestId);
}
