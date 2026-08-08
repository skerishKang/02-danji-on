import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthEnv {
  DATABASE_URL: string;
  APP_ENV?: string;
  DEV_AUTH_BYPASS?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
}

export type Actor = {
  id: string;
  authUserId: string;
  displayName: string;
};

type Sql = NeonQueryFunction<false, false>;
type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const DEV_AUTH_HEADER = 'x-danjion-dev-auth-user';
const jwksCache = new Map<string, RemoteJwks>();

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

function fail(code: string, message: string, status: number, requestId: string): Response {
  return json({ error: { code, message }, requestId }, status, requestId);
}

function authConfig(env: AuthEnv): { issuer: string; audience: string; jwksUrl: string } | null {
  const rawBaseUrl = env.NEON_AUTH_BASE_URL?.trim();
  if (!rawBaseUrl) return null;

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    return null;
  }
  if (baseUrl.protocol !== 'https:') return null;

  const issuer = baseUrl.origin;
  const rawJwksUrl = env.NEON_AUTH_JWKS_URL?.trim();
  let jwksUrl: URL;
  try {
    jwksUrl = rawJwksUrl
      ? new URL(rawJwksUrl)
      : new URL(`${rawBaseUrl.replace(/\/$/, '')}/.well-known/jwks.json`);
  } catch {
    return null;
  }
  if (jwksUrl.protocol !== 'https:') return null;

  return { issuer, audience: issuer, jwksUrl: jwksUrl.toString() };
}

function remoteJwks(jwksUrl: string): RemoteJwks {
  const cached = jwksCache.get(jwksUrl);
  if (cached) return cached;
  const created = createRemoteJWKSet(new URL(jwksUrl));
  jwksCache.set(jwksUrl, created);
  return created;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim();
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? '';
}

async function actorBySubject(sql: Sql, subject: string): Promise<Actor | null> {
  const rows = await sql`
    select id, auth_user_id, display_name
    from app_users
    where auth_user_id = ${subject}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    authUserId: String(row.auth_user_id),
    displayName: String(row.display_name)
  };
}

async function devActor(request: Request, env: AuthEnv, sql: Sql): Promise<Actor | null> {
  if (env.APP_ENV === 'production' || env.DEV_AUTH_BYPASS !== 'true') return null;
  const subject = request.headers.get(DEV_AUTH_HEADER)?.trim();
  if (!subject) return null;
  return actorBySubject(sql, subject);
}

function displayNameFromClaims(payload: JWTPayload): string {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  return name || '단지온 사용자';
}

function avatarFromClaims(payload: JWTPayload): string | null {
  const image = typeof payload.image === 'string' ? payload.image.trim() : '';
  return image || null;
}

async function resolveOrBootstrapActor(sql: Sql, payload: JWTPayload): Promise<Actor | null> {
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) return null;

  const existing = await actorBySubject(sql, subject);
  if (existing) return existing;

  const displayName = displayNameFromClaims(payload);
  const avatarUrl = avatarFromClaims(payload);
  const inserted = await sql`
    insert into app_users (auth_user_id, display_name, avatar_url)
    values (${subject}, ${displayName}, ${avatarUrl})
    on conflict (auth_user_id) do nothing
    returning id, auth_user_id, display_name
  `;
  const row = inserted[0];
  if (row) {
    return {
      id: String(row.id),
      authUserId: String(row.auth_user_id),
      displayName: String(row.display_name)
    };
  }

  return actorBySubject(sql, subject);
}

export async function requireActor(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const developmentActor = await devActor(request, env, sql);
  if (developmentActor) return developmentActor;

  const token = bearerToken(request);
  if (token === null) {
    return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);
  }
  if (!token) {
    return fail('AUTH_INVALID', 'Invalid authorization header', 401, requestId);
  }

  const config = authConfig(env);
  if (!config) {
    return fail('AUTH_NOT_CONFIGURED', 'Neon Auth verification is not configured', 503, requestId);
  }

  try {
    const { payload } = await jwtVerify(token, remoteJwks(config.jwksUrl), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['EdDSA']
    });

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) {
      return fail('AUTH_INVALID', 'Authenticated subject is missing', 401, requestId);
    }
    if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== subject) {
      return fail('AUTH_INVALID', 'Authenticated subject is inconsistent', 401, requestId);
    }
    if (payload.banned === true) {
      return fail('AUTH_FORBIDDEN', 'Authenticated user is blocked', 403, requestId);
    }

    const actor = await resolveOrBootstrapActor(sql, payload);
    if (!actor) {
      return fail('AUTH_IDENTITY_LINK_FAILED', 'Authenticated user could not be linked', 500, requestId);
    }
    return actor;
  } catch (error) {
    console.warn('[DanjiOn Auth]', requestId, error instanceof Error ? error.name : 'verification_failed');
    return fail('AUTH_INVALID', 'Invalid or expired authentication token', 401, requestId);
  }
}
