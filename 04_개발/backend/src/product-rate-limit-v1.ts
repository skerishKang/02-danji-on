import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

export type ProductMutationLimitKey =
  | 'community_post_create'
  | 'community_comment_create'
  | 'community_report_create'
  | 'family_invite_create'
  | 'family_invite_redeem'
  | 'business_application_create'
  | 'benefit_claim';

type ProductMutationPolicy = {
  action: ProductMutationLimitKey;
  max: number;
  windowSeconds: number;
};

export const PRODUCT_MUTATION_LIMITS: Record<ProductMutationLimitKey, ProductMutationPolicy> = {
  community_post_create: { action: 'community_post_create', max: 5, windowSeconds: 10 * 60 },
  community_comment_create: { action: 'community_comment_create', max: 30, windowSeconds: 10 * 60 },
  community_report_create: { action: 'community_report_create', max: 10, windowSeconds: 60 * 60 },
  family_invite_create: { action: 'family_invite_create', max: 10, windowSeconds: 60 * 60 },
  family_invite_redeem: { action: 'family_invite_redeem', max: 10, windowSeconds: 60 * 60 },
  business_application_create: { action: 'business_application_create', max: 5, windowSeconds: 24 * 60 * 60 },
  benefit_claim: { action: 'benefit_claim', max: 30, windowSeconds: 60 * 60 }
};

const REQUEST_ID_HEADER = 'x-danjion-request-id';

function fail(code: string, message: string, status: number, requestId: string): Response {
  return Response.json({ error: { code, message }, requestId }, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'cache-control': 'no-store'
    }
  });
}

function rateLimited(policy: ProductMutationPolicy, retryAfterSeconds: number, requestId: string): Response {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  return Response.json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests for this action. Try again later.'
    },
    requestId,
    retryAfterSeconds: retryAfter
  }, {
    status: 429,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'retry-after': String(retryAfter),
      'x-danjion-rate-limit-action': policy.action,
      'cache-control': 'no-store'
    }
  });
}

export function productMutationLimitForRequest(request: Request): ProductMutationLimitKey | null {
  if (request.method !== 'POST') return null;
  const path = new URL(request.url).pathname;

  if (/^\/api\/v1\/complexes\/[^/]+\/community\/posts$/.test(path)) {
    return 'community_post_create';
  }
  if (/^\/api\/v1\/complexes\/[^/]+\/community\/posts\/[0-9a-fA-F-]+\/comments$/.test(path)) {
    return 'community_comment_create';
  }
  if (/^\/api\/v1\/complexes\/[^/]+\/community\/reports$/.test(path)) {
    return 'community_report_create';
  }
  if (/^\/api\/v1\/complexes\/[^/]+\/household\/family-invites$/.test(path)) {
    return 'family_invite_create';
  }
  if (path === '/api/v1/household/family-invites/redeem') {
    return 'family_invite_redeem';
  }
  if (path === '/api/v1/me/business-applications') {
    return 'business_application_create';
  }
  if (/^\/api\/v1\/me\/benefits\/[0-9a-fA-F-]+\/claim$/.test(path)) {
    return 'benefit_claim';
  }
  return null;
}

/**
 * Atomically consumes one fixed-window product-mutation bucket.
 *
 * This control is intentionally separate from endpoint authorization. The
 * caller must still pass the existing Household/RBAC/ownership checks after a
 * rate-limit PASS. The only account key persisted here is app_users.id.
 */
export async function consumeProductMutationLimit(
  sql: Sql,
  actorUserId: string,
  policyKey: ProductMutationLimitKey,
  requestId: string
): Promise<Response | null> {
  const policy = PRODUCT_MUTATION_LIMITS[policyKey];
  try {
    const rows = await sql`
      with bucket as (
        select to_timestamp(
          floor(extract(epoch from now()) / ${policy.windowSeconds}) * ${policy.windowSeconds}
        ) as window_start
      ), pruned as (
        delete from product_mutation_rate_limits rl
        using bucket
        where rl.actor_user_id = ${actorUserId}::uuid
          and rl.action = ${policy.action}
          and rl.window_start < bucket.window_start
        returning rl.actor_user_id
      ), consumed as (
        insert into product_mutation_rate_limits (
          actor_user_id, action, window_start, request_count, updated_at
        )
        select ${actorUserId}::uuid, ${policy.action}, bucket.window_start, 1, now()
        from bucket
        on conflict (actor_user_id, action, window_start)
        do update set
          request_count = product_mutation_rate_limits.request_count + 1,
          updated_at = now()
        returning request_count, window_start
      )
      select
        request_count,
        greatest(
          1,
          ceil(extract(epoch from ((window_start + make_interval(secs => ${policy.windowSeconds})) - now())))
        )::int as retry_after_seconds
      from consumed
    `;

    const row = rows[0];
    if (!row) return fail('RATE_LIMIT_CHECK_FAILED', 'Rate limit could not be evaluated', 500, requestId);
    const count = Number(row.request_count);
    const retryAfterSeconds = Number(row.retry_after_seconds || policy.windowSeconds);
    if (!Number.isFinite(count) || !Number.isFinite(retryAfterSeconds)) {
      return fail('RATE_LIMIT_CHECK_FAILED', 'Rate limit could not be evaluated', 500, requestId);
    }
    return count > policy.max ? rateLimited(policy, retryAfterSeconds, requestId) : null;
  } catch (error) {
    console.error('[DanjiOn Product Rate Limit]', requestId, error instanceof Error ? error.name : 'rate_limit_failed');
    return fail('RATE_LIMIT_CHECK_FAILED', 'Rate limit could not be evaluated', 500, requestId);
  }
}

export async function handleProductMutationRateLimitRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const policyKey = productMutationLimitForRequest(request);
  if (!policyKey) return null;
  if (!env.DATABASE_URL) return fail('DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not configured', 503, requestId);

  const sql: Sql = neon(env.DATABASE_URL);
  const actorOrResponse = await requireActor(request, env, sql, requestId);
  if (actorOrResponse instanceof Response) return actorOrResponse;

  // RATE_LIMIT_PASS != AUTHORIZATION_PASS. Existing downstream endpoint guards
  // remain authoritative after this bounded abuse counter succeeds.
  return consumeProductMutationLimit(sql, actorOrResponse.id, policyKey, requestId);
}
