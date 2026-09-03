import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

function ok(data: unknown, requestId: string): Response {
  return Response.json({ data, requestId }, {
    status: 200,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

export async function handleResidentSummaryWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/me/summary') return null;
  if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);

  const complexSlug = (url.searchParams.get('complexSlug') || '').trim();
  const resident = await requireVerifiedResident(request, env, sql, requestId, complexSlug);
  if (resident instanceof Response) return resident;

  const rows = await sql`
    select
      (
        select count(*)::int
        from community_posts p
        where p.author_user_id = ${resident.id}::uuid
          and p.complex_id = ${resident.complexId}::uuid
          and p.status in ('published', 'pending_review')
      ) as post_count,
      (
        select count(*)::int
        from community_comments c
        where c.author_user_id = ${resident.id}::uuid
          and c.complex_id = ${resident.complexId}::uuid
          and c.status in ('published', 'pending_review')
      ) as comment_count,
      (
        select count(*)::int
        from community_reactions r
        join community_posts p
          on p.id = r.post_id
         and p.complex_id = r.complex_id
        where p.author_user_id = ${resident.id}::uuid
          and p.complex_id = ${resident.complexId}::uuid
          and p.status = 'published'
          and r.user_id <> ${resident.id}::uuid
      ) as received_reaction_count,
      (
        select count(*)::int
        from bookmarks bm
        join businesses b
          on b.id = bm.business_id
         and b.status = 'approved'
        join business_complex_relations rel
          on rel.business_id = b.id
         and rel.complex_id = ${resident.complexId}::uuid
         and rel.verification_status = 'verified'
        where bm.user_id = ${resident.id}::uuid
      ) as saved_business_count,
      (
        select count(*)::int
        from conversation_members mine
        join conversations conv
          on conv.id = mine.conversation_id
         and conv.complex_id = ${resident.complexId}::uuid
         and conv.type = 'resident'
        join messages m
          on m.conversation_id = conv.id
        where mine.user_id = ${resident.id}::uuid
          and m.sender_user_id <> ${resident.id}::uuid
          and m.deleted_at is null
          and (mine.last_read_at is null or m.created_at > mine.last_read_at)
      ) as unread_message_count
  `;

  const row = rows[0] || {};
  return ok({
    postCount: Number(row.post_count || 0),
    commentCount: Number(row.comment_count || 0),
    receivedReactionCount: Number(row.received_reaction_count || 0),
    savedBusinessCount: Number(row.saved_business_count || 0),
    unreadMessageCount: Number(row.unread_message_count || 0),
    household: {
      status: 'verified',
      membershipRole: resident.membershipRole
    }
  }, requestId);
}

export async function handleResidentSummaryRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/v1/me/summary') return null;
  return handleResidentSummaryWithSql(request, env, sqlFor(env), requestId);
}
