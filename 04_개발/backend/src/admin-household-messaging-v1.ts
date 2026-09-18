import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor, type Actor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { recordAuthorityDecision, resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;
type TargetType = 'unit' | 'units' | 'building' | 'all';
type UnitTarget = { buildingCode: string; unitCode: string };
type TargetRow = UnitTarget & {
  householdCount: number;
  recipientAccountCount: number;
};
type TargetSelection = {
  targetType: TargetType;
  buildingCode: string | null;
  units: UnitTarget[];
};
type HouseholdMessageEnv = CoreEnv & {
  HOUSEHOLD_MESSAGE_SEND_MODE?: string;
};

const SCOPE = 'household.message.manage';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SELECTED_UNITS = 100;
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;
const UNIT_PART = /^[0-9A-Za-z가-힣-]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;

function json(data: unknown, status: number, requestId: string): Response {
  return Response.json(data, {
    status,
    headers: {
      'x-danjion-request-id': requestId,
      'access-control-expose-headers': 'x-danjion-request-id',
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

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function dispatchEnabled(env: HouseholdMessageEnv): boolean {
  return env.HOUSEHOLD_MESSAGE_SEND_MODE?.trim().toLowerCase() === 'enabled';
}

function unitPart(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return UNIT_PART.test(text) ? text : null;
}

async function requirePadiemHouseholdMessageAuthority(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    const grantedScope = authority.wildcard ? '*' : authority.scopes.includes(SCOPE) ? SCOPE : null;
    if (!grantedScope) {
      await recordAuthorityDecision(sql, actor, requestId, SCOPE, 'denied', 'HOUSEHOLD_MESSAGE_SCOPE_MISSING', null);
      return fail('HOUSEHOLD_MESSAGE_FORBIDDEN', 'PADIEM household message authority required', 403, requestId);
    }
    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'allowed',
      authority.wildcard ? 'HOUSEHOLD_MESSAGE_WILDCARD_GRANTED' : 'HOUSEHOLD_MESSAGE_SCOPE_GRANTED',
      grantedScope
    );
    return actor;
  } catch {
    await recordAuthorityDecision(
      sql,
      actor,
      requestId,
      SCOPE,
      'denied',
      'HOUSEHOLD_MESSAGE_AUTHORITY_DB_ERROR',
      null
    ).catch(() => {});
    return fail('HOUSEHOLD_MESSAGE_AUTHORITY_UNAVAILABLE', 'Household message authority could not be verified', 503, requestId);
  }
}

async function targetRows(sql: Sql, complexSlug: string): Promise<TargetRow[]> {
  const rows = await sql`
    select
      cu.building_code,
      cu.unit_code,
      count(distinct h.id)::int as household_count,
      count(distinct hm.user_id) filter (where hm.status = 'verified')::int as recipient_account_count
    from complex_units cu
    join complexes c on c.id = cu.complex_id
    left join households h
      on h.complex_unit_id = cu.id
      and h.complex_id = cu.complex_id
      and h.status = 'active'
    left join household_memberships hm
      on hm.household_id = h.id
      and hm.complex_id = h.complex_id
      and hm.status = 'verified'
    where c.slug = ${complexSlug}
      and c.status <> 'inactive'
      and cu.status = 'active'
    group by cu.id, cu.building_code, cu.unit_code
    order by
      case when cu.building_code ~ '^[0-9]+$' then cu.building_code::numeric else null end nulls last,
      cu.building_code asc,
      case when cu.unit_code ~ '^[0-9]+$' then cu.unit_code::numeric else null end nulls last,
      cu.unit_code asc
  `;

  return rows.map((row) => ({
    buildingCode: String(row.building_code),
    unitCode: String(row.unit_code),
    householdCount: Number(row.household_count || 0),
    recipientAccountCount: Number(row.recipient_account_count || 0)
  }));
}

function assertUnambiguous(rows: TargetRow[], requestId: string): Response | null {
  if (rows.some((row) => row.householdCount > 1)) {
    return fail(
      'HOUSEHOLD_MAPPING_AMBIGUOUS',
      'Household mapping is ambiguous; messaging target resolution failed closed',
      409,
      requestId
    );
  }
  return null;
}

async function readJsonObject(
  request: Request,
  requestId: string
): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fail('INVALID_JSON', 'JSON object required', 400, requestId);
    }
    return parsed as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
}

function parseTargetRecord(record: Record<string, unknown>, requestId: string): TargetSelection | Response {
  const targetType = String(record.targetType || '').trim() as TargetType;
  if (!['unit', 'units', 'building', 'all'].includes(targetType)) {
    return fail('VALIDATION_ERROR', 'targetType must be unit, units, building or all', 400, requestId);
  }

  const buildingCode = record.buildingCode === undefined || record.buildingCode === null
    ? null
    : unitPart(record.buildingCode);
  const rawUnits = record.units === undefined ? [] : record.units;
  if (!Array.isArray(rawUnits)) return fail('VALIDATION_ERROR', 'units must be an array', 400, requestId);

  const units: UnitTarget[] = [];
  const seen = new Set<string>();
  for (const candidate of rawUnits) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return fail('VALIDATION_ERROR', 'Each unit target must be an object', 400, requestId);
    }
    const item = candidate as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['buildingCode', 'unitCode'].includes(key))) {
      return fail('VALIDATION_ERROR', 'Unit targets accept only buildingCode and unitCode', 400, requestId);
    }
    const building = unitPart(item.buildingCode);
    const unit = unitPart(item.unitCode);
    if (!building || !unit) return fail('VALIDATION_ERROR', 'Invalid buildingCode or unitCode', 400, requestId);
    const key = `${building}\\u0000${unit}`;
    if (!seen.has(key)) {
      seen.add(key);
      units.push({ buildingCode: building, unitCode: unit });
    }
  }

  units.sort((a, b) => a.buildingCode.localeCompare(b.buildingCode) || a.unitCode.localeCompare(b.unitCode));

  if (units.length > MAX_SELECTED_UNITS) {
    return fail('VALIDATION_ERROR', 'Too many selected units', 400, requestId);
  }
  if (targetType === 'unit' && units.length !== 1) {
    return fail('VALIDATION_ERROR', 'unit target requires exactly one unit', 400, requestId);
  }
  if (targetType === 'units' && units.length < 1) {
    return fail('VALIDATION_ERROR', 'units target requires at least one unit', 400, requestId);
  }
  if ((targetType === 'building' && !buildingCode) || (targetType !== 'building' && buildingCode !== null)) {
    return fail('VALIDATION_ERROR', 'buildingCode is accepted only for building targets', 400, requestId);
  }
  if ((targetType === 'building' || targetType === 'all') && units.length !== 0) {
    return fail('VALIDATION_ERROR', 'units are accepted only for unit or units targets', 400, requestId);
  }

  return { targetType, buildingCode, units };
}

function selectedTargetRows(
  rows: TargetRow[],
  payload: TargetSelection,
  requestId: string
): TargetRow[] | Response {
  let selected: TargetRow[] = [];
  if (payload.targetType === 'all') {
    selected = rows;
  } else if (payload.targetType === 'building') {
    selected = rows.filter((row) => row.buildingCode === payload.buildingCode);
  } else {
    const requested = new Set(payload.units.map((unit) => `${unit.buildingCode}\\u0000${unit.unitCode}`));
    selected = rows.filter((row) => requested.has(`${row.buildingCode}\\u0000${row.unitCode}`));
    if (selected.length !== requested.size) {
      return fail('HOUSEHOLD_MESSAGE_TARGET_NOT_FOUND', 'One or more target units do not exist', 404, requestId);
    }
  }
  if (!selected.length) {
    return fail('HOUSEHOLD_MESSAGE_TARGET_NOT_FOUND', 'No target units matched', 404, requestId);
  }
  return selected;
}

function targetSnapshot(payload: TargetSelection): Record<string, unknown> {
  if (payload.targetType === 'building') return { buildingCode: payload.buildingCode };
  if (payload.targetType === 'unit' || payload.targetType === 'units') return { units: payload.units };
  return {};
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function listTargets(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  try {
    const rows = await targetRows(sql, complexSlug);
    const ambiguous = assertUnambiguous(rows, requestId);
    if (ambiguous) return ambiguous;

    return ok({
      units: rows.map((row) => ({
        buildingCode: row.buildingCode,
        unitCode: row.unitCode
      })),
      deliveryChannel: 'in_app',
      sendEnabled: false
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_TARGETS_UNAVAILABLE', 'Household message targets could not be loaded', 503, requestId);
  }
}

async function previewTargets(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const record = await readJsonObject(request, requestId);
  if (record instanceof Response) return record;
  if (Object.keys(record).some((key) => !['targetType', 'buildingCode', 'units'].includes(key))) {
    return fail('VALIDATION_ERROR', 'Only targetType, buildingCode and units are accepted', 400, requestId);
  }
  const payload = parseTargetRecord(record, requestId);
  if (payload instanceof Response) return payload;

  try {
    const rows = await targetRows(sql, complexSlug);
    const selected = selectedTargetRows(rows, payload, requestId);
    if (selected instanceof Response) return selected;
    const ambiguous = assertUnambiguous(selected, requestId);
    if (ambiguous) return ambiguous;

    return ok({
      targetType: payload.targetType,
      targetUnitCount: selected.length,
      recipientAccountCount: selected.reduce((sum, row) => sum + row.recipientAccountCount, 0),
      deliveryChannel: 'in_app',
      sendEnabled: false,
      dispatchStatus: 'disabled_pending_activation'
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_PREVIEW_UNAVAILABLE', 'Household message preview could not be calculated', 503, requestId);
  }
}

async function createHouseholdMessage(
  request: Request,
  env: HouseholdMessageEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return fail('IDEMPOTENCY_KEY_REQUIRED', 'Valid Idempotency-Key header required', 400, requestId);
  }

  const record = await readJsonObject(request, requestId);
  if (record instanceof Response) return record;
  if (Object.keys(record).some((key) => !['targetType', 'buildingCode', 'units', 'title', 'body'].includes(key))) {
    return fail('VALIDATION_ERROR', 'Unexpected household message field', 400, requestId);
  }

  const selection = parseTargetRecord(record, requestId);
  if (selection instanceof Response) return selection;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const body = typeof record.body === 'string' ? record.body.trim() : '';
  if (!title || title.length > 120) return fail('VALIDATION_ERROR', 'title must be 1-120 characters', 400, requestId);
  if (!body || body.length > 4000) return fail('VALIDATION_ERROR', 'body must be 1-4000 characters', 400, requestId);

  try {
    const rows = await targetRows(sql, complexSlug);
    const selected = selectedTargetRows(rows, selection, requestId);
    if (selected instanceof Response) return selected;
    const ambiguous = assertUnambiguous(selected, requestId);
    if (ambiguous) return ambiguous;

    const snapshot = targetSnapshot(selection);
    const snapshotJson = JSON.stringify(snapshot);
    const recipientCount = selected.reduce((sum, row) => sum + row.recipientAccountCount, 0);
    const fingerprint = await sha256Hex(JSON.stringify({
      targetType: selection.targetType,
      targetSelector: snapshot,
      title,
      body
    }));

    const persisted = await sql`
      with selected_complex as (
        select id
        from complexes
        where slug = ${complexSlug}
          and status <> 'inactive'
        limit 1
      ),
      inserted as (
        insert into household_messages (
          complex_id,
          sender_user_id,
          target_type,
          target_selector,
          title,
          body,
          status,
          idempotency_key,
          request_fingerprint,
          target_unit_count,
          intended_recipient_count
        )
        select
          c.id,
          ${actor.id}::uuid,
          ${selection.targetType},
          ${snapshotJson}::jsonb,
          ${title},
          ${body},
          'draft',
          ${idempotencyKey},
          ${fingerprint},
          ${selected.length},
          ${recipientCount}
        from selected_complex c
        on conflict (complex_id, idempotency_key) do nothing
        returning id, complex_id, target_type, status, request_fingerprint,
                  target_unit_count, intended_recipient_count, created_at
      ),
      created_event as (
        insert into household_message_events (
          message_id,
          event_type,
          actor_user_id,
          request_id,
          intended_recipient_count
        )
        select id, 'created', ${actor.id}::uuid, ${requestId}, intended_recipient_count
        from inserted
        returning message_id
      ),
      chosen as (
        select i.*, true as created
        from inserted i
        union all
        select
          hm.id,
          hm.complex_id,
          hm.target_type,
          hm.status,
          hm.request_fingerprint,
          hm.target_unit_count,
          hm.intended_recipient_count,
          hm.created_at,
          false as created
        from household_messages hm
        join selected_complex c on c.id = hm.complex_id
        where hm.idempotency_key = ${idempotencyKey}
          and not exists (select 1 from inserted)
        limit 1
      )
      select chosen.*, exists(select 1 from created_event) as audit_created
      from chosen
      limit 1
    `;

    if (!persisted[0]) return fail('COMPLEX_NOT_FOUND', 'Apartment complex not found', 404, requestId);
    if (String(persisted[0].request_fingerprint) !== fingerprint) {
      return fail('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different content', 409, requestId);
    }

    return ok({
      id: String(persisted[0].id),
      targetType: String(persisted[0].target_type),
      status: String(persisted[0].status),
      targetUnitCount: Number(persisted[0].target_unit_count || 0),
      recipientAccountCount: Number(persisted[0].intended_recipient_count || 0),
      deliveryChannel: 'in_app',
      dispatchEnabled: dispatchEnabled(env),
      idempotentReplay: !Boolean(persisted[0].created),
      createdAt: persisted[0].created_at
    }, requestId, Boolean(persisted[0].created) ? 201 : 200);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_CREATE_UNAVAILABLE', 'Household message could not be persisted', 503, requestId);
  }
}

async function dispatchHouseholdMessage(
  request: Request,
  env: HouseholdMessageEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string,
  messageId: string
): Promise<Response> {
  const actor = await requirePadiemHouseholdMessageAuthority(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  if (!dispatchEnabled(env)) {
    return fail(
      'HOUSEHOLD_MESSAGE_DISPATCH_DISABLED',
      'Household message dispatch is disabled pending explicit activation',
      409,
      requestId
    );
  }

  try {
    const rows = await sql`
      with current_message as (
        select hm.*
        from household_messages hm
        join complexes c on c.id = hm.complex_id
        where hm.id = ${messageId}::uuid
          and c.slug = ${complexSlug}
          and c.status <> 'inactive'
        limit 1
      ),
      selected_units as (
        select cu.id
        from current_message m
        join complex_units cu
          on cu.complex_id = m.complex_id
         and cu.status = 'active'
        where
          m.target_type = 'all'
          or (m.target_type = 'building' and cu.building_code = m.target_selector->>'buildingCode')
          or (
            m.target_type in ('unit','units')
            and exists (
              select 1
              from jsonb_array_elements(coalesce(m.target_selector->'units', '[]'::jsonb)) target
              where target->>'buildingCode' = cu.building_code
                and target->>'unitCode' = cu.unit_code
            )
          )
      ),
      ambiguity as (
        select exists (
          select 1
          from selected_units su
          join households h
            on h.complex_unit_id = su.id
           and h.status = 'active'
          group by su.id
          having count(distinct h.id) > 1
        ) as ambiguous
      ),
      candidate_recipients as (
        select distinct hm.user_id
        from selected_units su
        join households h
          on h.complex_unit_id = su.id
         and h.status = 'active'
        join household_memberships hm
          on hm.household_id = h.id
         and hm.complex_id = h.complex_id
         and hm.status = 'verified'
        join app_users u
          on u.id = hm.user_id
         and u.account_status = 'active'
      ),
      attempt as (
        insert into household_message_events (
          message_id,
          event_type,
          actor_user_id,
          request_id,
          intended_recipient_count
        )
        select
          m.id,
          'dispatch_started',
          ${actor.id}::uuid,
          ${requestId},
          (select count(*)::int from candidate_recipients)
        from current_message m
        cross join ambiguity a
        where m.status = 'draft'
          and not a.ambiguous
          and exists (select 1 from candidate_recipients)
        on conflict (message_id, event_type) do nothing
        returning message_id
      ),
      deliveries as (
        insert into household_message_deliveries (message_id, user_id, delivered_at)
        select a.message_id, r.user_id, now()
        from attempt a
        cross join candidate_recipients r
        on conflict (message_id, user_id) do nothing
        returning message_id, user_id
      ),
      notification_rows as (
        insert into notifications (
          user_id,
          complex_id,
          type,
          actor_user_id,
          resource_type,
          resource_id,
          source_event_key,
          title
        )
        select
          d.user_id,
          m.complex_id,
          'household_message',
          null,
          'household_message',
          m.id,
          'household_message:' || m.id::text,
          m.title
        from deliveries d
        join current_message m on m.id = d.message_id
        on conflict (user_id, source_event_key) where source_event_key is not null do nothing
        returning user_id
      ),
      updated as (
        update household_messages hm
        set
          status = 'sent',
          target_unit_count = (select count(*)::int from selected_units),
          intended_recipient_count = (select count(*)::int from candidate_recipients),
          delivered_recipient_count = (select count(*)::int from deliveries),
          failed_recipient_count =
            (select count(*)::int from candidate_recipients) - (select count(*)::int from deliveries),
          sent_at = now(),
          updated_at = now()
        from attempt a
        where hm.id = a.message_id
        returning hm.id, hm.status, hm.target_unit_count, hm.intended_recipient_count,
                  hm.delivered_recipient_count, hm.failed_recipient_count, hm.sent_at
      ),
      completed as (
        insert into household_message_events (
          message_id,
          event_type,
          actor_user_id,
          request_id,
          intended_recipient_count,
          delivered_recipient_count,
          failed_recipient_count
        )
        select
          u.id,
          'dispatch_completed',
          ${actor.id}::uuid,
          ${requestId},
          u.intended_recipient_count,
          u.delivered_recipient_count,
          u.failed_recipient_count
        from updated u
        on conflict (message_id, event_type) do nothing
        returning message_id
      )
      select
        m.id,
        m.status as previous_status,
        m.target_unit_count as previous_target_unit_count,
        m.intended_recipient_count as previous_intended_recipient_count,
        m.delivered_recipient_count as previous_delivered_recipient_count,
        m.failed_recipient_count as previous_failed_recipient_count,
        m.sent_at as previous_sent_at,
        (select ambiguous from ambiguity) as ambiguous,
        (select count(*)::int from candidate_recipients) as current_recipient_count,
        exists(select 1 from attempt) as dispatch_started,
        exists(select 1 from completed) as dispatch_completed,
        (select count(*)::int from notification_rows) as notification_count,
        (select status from updated limit 1) as final_status,
        (select target_unit_count from updated limit 1) as final_target_unit_count,
        (select intended_recipient_count from updated limit 1) as final_intended_recipient_count,
        (select delivered_recipient_count from updated limit 1) as final_delivered_recipient_count,
        (select failed_recipient_count from updated limit 1) as final_failed_recipient_count,
        (select sent_at from updated limit 1) as final_sent_at
      from current_message m
      limit 1
    `;

    const row = rows[0];
    if (!row) return fail('HOUSEHOLD_MESSAGE_NOT_FOUND', 'Household message not found', 404, requestId);

    if (String(row.previous_status) === 'sent') {
      return ok({
        id: String(row.id),
        status: 'sent',
        targetUnitCount: Number(row.previous_target_unit_count || 0),
        recipientAccountCount: Number(row.previous_intended_recipient_count || 0),
        deliveredCount: Number(row.previous_delivered_recipient_count || 0),
        failedCount: Number(row.previous_failed_recipient_count || 0),
        sentAt: row.previous_sent_at,
        deliveryChannel: 'in_app',
        idempotentReplay: true
      }, requestId);
    }

    if (Boolean(row.ambiguous)) {
      return fail(
        'HOUSEHOLD_MAPPING_AMBIGUOUS',
        'Household mapping is ambiguous; messaging dispatch failed closed',
        409,
        requestId
      );
    }

    if (Number(row.current_recipient_count || 0) === 0) {
      return fail('HOUSEHOLD_MESSAGE_NO_RECIPIENTS', 'No verified recipients matched at send time', 409, requestId);
    }

    if (!Boolean(row.dispatch_started) || !Boolean(row.dispatch_completed)) {
      return fail('HOUSEHOLD_MESSAGE_DISPATCH_IN_PROGRESS', 'A dispatch attempt already owns this message', 409, requestId);
    }

    return ok({
      id: String(row.id),
      status: String(row.final_status || 'sent'),
      targetUnitCount: Number(row.final_target_unit_count || 0),
      recipientAccountCount: Number(row.final_intended_recipient_count || 0),
      deliveredCount: Number(row.final_delivered_recipient_count || 0),
      failedCount: Number(row.final_failed_recipient_count || 0),
      sentAt: row.final_sent_at,
      deliveryChannel: 'in_app',
      idempotentReplay: false
    }, requestId);
  } catch {
    return fail('HOUSEHOLD_MESSAGE_DISPATCH_UNAVAILABLE', 'Household message dispatch could not be completed', 503, requestId);
  }
}

export async function handleAdminHouseholdMessagingWithSql(
  request: Request,
  env: HouseholdMessageEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);

  const targetsMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages\/targets$/
  );
  if (targetsMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(targetsMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return listTargets(request, env, sql, requestId, complexSlug);
  }

  const previewMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages\/preview$/
  );
  if (previewMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(previewMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return previewTargets(request, env, sql, requestId, complexSlug);
  }

  const dispatchMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages\/([0-9a-fA-F-]+)\/dispatch$/
  );
  if (dispatchMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(dispatchMatch[1]).trim();
    const messageId = dispatchMatch[2].toLowerCase();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    if (!UUID.test(messageId)) return fail('HOUSEHOLD_MESSAGE_INVALID', 'Invalid household message id', 400, requestId);
    return dispatchHouseholdMessage(request, env, sql, requestId, complexSlug, messageId);
  }

  const createMatch = url.pathname.match(
    /^\/api\/v1\/admin\/complexes\/([^/]+)\/household-messages$/
  );
  if (createMatch) {
    if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const complexSlug = decodeURIComponent(createMatch[1]).trim();
    if (!SLUG.test(complexSlug)) return fail('COMPLEX_INVALID', 'Invalid apartment complex', 400, requestId);
    return createHouseholdMessage(request, env, sql, requestId, complexSlug);
  }

  return null;
}

export async function handleAdminHouseholdMessagingRequest(
  request: Request,
  env: HouseholdMessageEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/api/v1/admin/') || !path.includes('/household-messages')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleAdminHouseholdMessagingWithSql(request, env, sqlFor(env), requestId);
}
