import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident } from './authorization-v2';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;
type NewsReactionEnv = CoreEnv;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REACTION_TYPE = 'like';

export const NEWS_REACTION_PATH =
  '/api/v1/complexes/:slug/news/posts/:postId/reaction';

function ok(data: unknown, requestId: string, status = 200): Response {
  return Response.json({ data, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: { 'x-danjion-request-id': requestId, 'cache-control': 'no-store' }
  });
}

// #768: the 공감 count is never trusted from the client. Every mutation writes,
// then reads the count back from complex_post_reactions inside the same request,
// so the response the UI renders is the database value.
async function reactionState(sql: Sql, complexId: string, postId: string, userId: string) {
  const rows = await sql`
    select
      (select count(*) from complex_post_reactions r
        where r.post_id = ${postId}::uuid and r.reaction_type = ${REACTION_TYPE})::int as reaction_count,
      exists(
        select 1 from complex_post_reactions v
        where v.post_id = ${postId}::uuid
          and v.user_id = ${userId}::uuid
          and v.reaction_type = ${REACTION_TYPE}
      ) as active
  `;
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  return {
    postId,
    reactionType: REACTION_TYPE,
    active: row.active === true,
    reactionCount: Number(row.reaction_count ?? 0)
  };
}

export async function handleComplexNewsReactionRequest(
  request: Request,
  env: NewsReactionEnv,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/v1\/complexes\/([a-z0-9][a-z0-9-]{0,119})\/news\/posts\/([0-9a-fA-F-]+)\/reaction$/
  );
  if (!match) return null;
  if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'DELETE') {
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  const sql = neon(env.DATABASE_URL);
  const slug = match[1];
  const postId = match[2];
  if (!UUID_RE.test(postId)) return fail('NOT_FOUND', 'Post not found', 404, requestId);

  // 401 (signed out) and 403 RESIDENT_VERIFICATION_REQUIRED (signed in but not a
  // verified resident) stay distinguishable: #765 requires that a verification
  // boundary is never rendered as a "log in again" message.
  const resident = await requireVerifiedResident(request, env, sql, requestId, slug);
  if (resident instanceof Response) return resident;

  const posts = await sql`
    select id
    from complex_posts
    where id = ${postId}::uuid
      and complex_id = ${resident.complexId}::uuid
      and status = 'published'
    limit 1
  `;
  if (!posts[0]) return fail('NOT_FOUND', 'Post not found', 404, requestId);

  if (request.method === 'POST') {
    await sql`
      insert into complex_post_reactions (complex_id, post_id, user_id, reaction_type)
      values (${resident.complexId}::uuid, ${postId}::uuid, ${resident.id}::uuid, ${REACTION_TYPE})
      on conflict (post_id, user_id, reaction_type) do nothing
    `;
    return ok(await reactionState(sql, resident.complexId, postId, resident.id), requestId);
  }

  if (request.method === 'DELETE') {
    await sql`
      delete from complex_post_reactions
      where complex_id = ${resident.complexId}::uuid
        and post_id = ${postId}::uuid
        and user_id = ${resident.id}::uuid
        and reaction_type = ${REACTION_TYPE}
    `;
    return ok(await reactionState(sql, resident.complexId, postId, resident.id), requestId);
  }

  return ok(await reactionState(sql, resident.complexId, postId, resident.id), requestId);
}
