import type { NeonQueryFunction } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthEnv {
  DATABASE_URL: string;
  APP_ENV?: string;
  DEV_AUTH_BYPASS?: string;
  DANJION_AUTH_BASE_URL?: string;
  DANJION_AUTH_JWKS_URL?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
}

export type Actor = {
  id: string;
  authUserId: string;
  displayName: string;
};

type ActorRecord = Actor & {
  accountStatus: 'active' | 'closed';
};

type ActorResolution = Actor | 'closed' | 'onboarding' | null;
type Sql = NeonQueryFunction<false, false>;
type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;
type AuthConfig = { issuer: string; audience: string; jwksUrl: string; authority: 'danjion' | 'neon' };

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

function secureUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') return parsed;
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.protocol === 'http:') return parsed;
    return null;
  } catch {
    return null;
  }
}

function danjionAuthConfig(env: AuthEnv): AuthConfig | null {
  const rawBaseUrl = env.DANJION_AUTH_BASE_URL?.trim();
  if (!rawBaseUrl) return null;
  const baseUrl = secureUrl(rawBaseUrl);
  if (!baseUrl) return null;
  const issuer = baseUrl.toString().replace(/\/$/, '');
  const rawJwksUrl = env.DANJION_AUTH_JWKS_URL?.trim();
  const jwksUrl = secureUrl(rawJwksUrl || `${issuer}/api/auth/jwks`);
  if (!jwksUrl) return null;
  return { issuer, audience: issuer, jwksUrl: jwksUrl.toString(), authority: 'danjion' };
}

function neonAuthConfig(env: AuthEnv): AuthConfig | null {
  const rawBaseUrl = env.NEON_AUTH_BASE_URL?.trim();
  if (!rawBaseUrl) return null;
  const baseUrl = secureUrl(rawBaseUrl);
  if (!baseUrl) return null;
  const issuer = baseUrl.origin;
  const rawJwksUrl = env.NEON_AUTH_JWKS_URL?.trim();
  const jwksUrl = secureUrl(rawJwksUrl || `${rawBaseUrl.replace(/\/$/, '')}/.well-known/jwks.json`);
  if (!jwksUrl) return null;
  return { issuer, audience: issuer, jwksUrl: jwksUrl.toString(), authority: 'neon' };
}

function authConfig(env: AuthEnv): AuthConfig | null {
  return danjionAuthConfig(env) ?? neonAuthConfig(env);
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

async function actorRecordBySubject(sql: Sql, subject: string): Promise<ActorRecord | null> {
  const rows = await sql`
    select id, auth_user_id, display_name, account_status
    from app_users
    where auth_user_id = ${subject}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const rawStatus = row.account_status == null ? 'active' : String(row.account_status);
  const accountStatus: 'active' | 'closed' = rawStatus === 'closed' ? 'closed' : 'active';
  return {
    id: String(row.id),
    authUserId: String(row.auth_user_id),
    displayName: String(row.display_name),
    accountStatus
  };
}

function publicActor(record: ActorRecord): Actor {
  return { id: record.id, authUserId: record.authUserId, displayName: record.displayName };
}

async function actorBySubject(sql: Sql, subject: string): Promise<Actor | 'closed' | null> {
  const record = await actorRecordBySubject(sql, subject);
  if (!record) return null;
  return record.accountStatus === 'closed' ? 'closed' : publicActor(record);
}

async function approvedSocialProviderAccount(sql: Sql, subject: string): Promise<boolean> {
  const rows = await sql`
    select provider_id
    from danjion_auth.account
    where user_id = ${subject}
      and provider_id in ('google', 'naver', 'kakao')
    limit 1
  `;
  return Boolean(rows[0]);
}

async function completedContactOnboarding(sql: Sql, subject: string): Promise<boolean> {
  const rows = await sql`
    select 1
    from signup_contact_receipts
    where auth_user_id = ${subject}
      and consumed_at is not null
    limit 1
  `;
  return Boolean(rows[0]);
}

async function devActor(request: Request, env: AuthEnv, sql: Sql): Promise<Actor | 'closed' | null> {
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

async function resolveOrBootstrapActor(
  sql: Sql,
  payload: JWTPayload,
  requireContactOnboarding: boolean
): Promise<ActorResolution> {
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) return null;

  // Existing product users keep their current product authority. New Google,
  // Naver and Kakao OAuth accounts do not receive a second-factor phone gate.
  // Credential/email accounts continue to require the verified-phone receipt;
  // the future KakaoTalk delivery route for that direct path is tracked by #235.
  const existing = await actorBySubject(sql, subject);
  if (existing) return existing;

  if (requireContactOnboarding) {
    const socialAccount = await approvedSocialProviderAccount(sql, subject);
    if (!socialAccount && !await completedContactOnboarding(sql, subject)) {
      return 'onboarding';
    }
  }

  const displayName = displayNameFromClaims(payload);
  const avatarUrl = avatarFromClaims(payload);
  const inserted = await sql`
    insert into app_users (auth_user_id, display_name, avatar_url)
    values (${subject}, ${displayName}, ${avatarUrl})
    on conflict (auth_user_id) do nothing
    returning id, auth_user_id, display_name, account_status
  `;
  const row = inserted[0];
  if (row) {
    const rawStatus = row.account_status == null ? 'active' : String(row.account_status);
    if (rawStatus === 'closed') return 'closed';
    return {
      id: String(row.id),
      authUserId: String(row.auth_user_id),
      displayName: String(row.display_name)
    };
  }
  return actorBySubject(sql, subject);
}

async function verifyToken(token: string, config: AuthConfig): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, remoteJwks(config.jwksUrl), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['EdDSA']
    });
    return payload;
  } catch {
    return null;
  }
}

export async function requireActor(
  request: Request,
  env: AuthEnv,
  sql: Sql,
  requestId: string
): Promise<Actor | Response> {
  const developmentActor = await devActor(request, env, sql);
  if (developmentActor === 'closed') {
    return fail('AUTH_ACCOUNT_CLOSED', 'DanjiOn product account is closed', 403, requestId);
  }
  if (developmentActor) return developmentActor;

  const token = bearerToken(request);
  if (token === null) return fail('AUTH_REQUIRED', 'Authentication required', 401, requestId);
  if (!token) return fail('AUTH_INVALID', 'Invalid authorization header', 401, requestId);

  const config = authConfig(env);
  if (!config) return fail('AUTH_NOT_CONFIGURED', 'Authentication verification is not configured', 503, requestId);

  const payload = await verifyToken(token, config);
  if (!payload) return fail('AUTH_INVALID', 'Invalid or expired authentication token', 401, requestId);

  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) return fail('AUTH_INVALID', 'Authenticated subject is missing', 401, requestId);
  if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== subject) {
    return fail('AUTH_INVALID', 'Authenticated subject is inconsistent', 401, requestId);
  }
  if (payload.banned === true) return fail('AUTH_FORBIDDEN', 'Authenticated user is blocked', 403, requestId);

  try {
    const actor = await resolveOrBootstrapActor(sql, payload, config.authority === 'danjion');
    if (actor === 'closed') return fail('AUTH_ACCOUNT_CLOSED', 'DanjiOn product account is closed', 403, requestId);
    if (actor === 'onboarding') {
      return fail(
        'AUTH_ACCOUNT_ONBOARDING_REQUIRED',
        'Phone contact verification is required for direct email signup before using DanjiOn product features',
        403,
        requestId
      );
    }
    if (!actor) return fail('AUTH_IDENTITY_LINK_FAILED', 'Authenticated user could not be linked', 500, requestId);
    return actor;
  } catch (error) {
    console.error('[DanjiOn Auth Link]', requestId, error instanceof Error ? error.name : 'identity_link_failed');
    return fail('AUTH_IDENTITY_LINK_FAILED', 'Authenticated user could not be linked', 500, requestId);
  }
}
