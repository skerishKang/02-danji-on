import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function ok(data: unknown, requestId: string): Response {
  return json({ data, requestId }, 200, requestId);
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function publicMessage(row: Record<string, unknown>) {
  return {
    id: String(row.message_id),
    title: String(row.title),
    body: String(row.body),
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at ?? null,
    deliveryChannel: 'in_app'
  };
}

async function listMessages(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const rows = await sql\`
    select *
    from resident_household_message_feed(\${actor.id}::uuid, null::uuid)
  \`;

  return ok({ messages: rows.map((row) => publicMessage(row)) }, requestId);
}

async function getMessage(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  messageId: string
): Promise<Response> {
  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;

  const rows = await sql\`
    select *
    from resident_household_message_feed(\${actor.id}::uuid, \${messageId}::uuid)
  \`;

  if (!rows[0]) return fail('HOUSEHOLD_MESSAGE_NOT_FOUND', 'Household message not found', 404, requestId);
  return ok(publicMessage(rows[0]), requestId);
}

export async function handleResidentHouseholdMessageWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === '/api/v1/me/household-messages') {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return listMessages(request, env, sql, requestId);
  }

  const itemMatch = path.match(/^\/api\/v1\/me\/household-messages\/([0-9a-fA-F-]+)$/);
  if (itemMatch) {
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    const messageId = itemMatch[1].toLowerCase();
    if (!UUID.test(messageId)) return fail('HOUSEHOLD_MESSAGE_INVALID', 'Invalid household message id', 400, requestId);
    return getMessage(request, env, sql, requestId, messageId);
  }

  return null;
}

export async function handleResidentHouseholdMessageRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/v1/me/household-messages')) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);
  return handleResidentHouseholdMessageWithSql(request, env, sqlFor(env), requestId);
}
