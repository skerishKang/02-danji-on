import type { NeonQueryFunction } from '@neondatabase/serverless';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload
} from 'jose';

export interface AuthEnv {
  DATABASE_URL: string;
  APP_ENV?: string;
  DEV_AUTH_BYPASS?: string;
  DANJION_AUTH_BASE_URL?: string;
  DANJION_AUTH_JWKS_URL?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
  // #868 temporary resident access switch. Fail-closed: only the exact string
  // 'true' enables it; absent/false restores strict resident verification.
  TEMP_RESIDENT_ACCESS_MODE?: string;
}

export type Actor = {
  id: string;
  authUserId: string;
  displayName: string;
};

type ActorRecord = Actor & {
  accountStatus: 'active' | 'closed';
};

type ActorResolution = Actor | 'closed' | null;
type Sql = NeonQueryFunction<false, false>;
type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;
type LocalJwks = ReturnType<typeof createLocalJWKSet>;
type JwksResolver = RemoteJwks | LocalJwks;
type AuthConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  authority: 'danjion' | 'neon';
  jwksSource: 'local' | 'remote';
};

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const DEV_AUTH_HEADER = 'x-danjion-dev-auth-user';
const jwksCache = new Map<string, RemoteJwks>();
// Better Auth 1.7.1 default JWKS grace period: expired keys stay verifiable
// for 30 days (options.jwks.gracePeriod is unset in this app).
const BETTER_AUTH_JWKS_GRACE_MS = 3600 * 24 * 30 * 1000;

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
  return {
    issuer,
    audience: issuer,
    jwksUrl: jwksUrl.toString(),
    authority: 'danjion',
    // Default DanjiOn authority verifies against the Better Auth public JWKS
    // rows in this same database; an explicit DANJION_AUTH_JWKS_URL keeps the
    // legacy remote-fetch contract as an external override.
    jwksSource: rawJwksUrl ? 'remote' : 'local'
  };
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
  return { issuer, audience: issuer, jwksUrl: jwksUrl.toString(), authority: 'neon', jwksSource: 'remote' };
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

// Builds a jose local JWK Set from Better Auth public JWKS rows already stored
// in this same database, removing the production self-fetch over HTTP. Only
// public columns are selected; private_key is never read for verification.
// JWK construction and 30-day grace filtering mirror Better Auth 1.7.1 /jwks.
async function danjionLocalJwks(sql: Sql): Promise<LocalJwks> {
  const rows = await sql`
    select id, public_key, alg, crv, expires_at
    from danjion_auth.jwks
  `;
  const now = Date.now();
  const keys: JSONWebKeySet['keys'] = [];
  for (const row of rows) {
    if (row.expires_at != null) {
      const expiresAt = row.expires_at instanceof Date
        ? row.expires_at
        : new Date(String(row.expires_at));
      if (!(expiresAt.getTime() + BETTER_AUTH_JWKS_GRACE_MS > now)) continue;
    }
    let publicJwk: unknown;
    try {
      publicJwk = JSON.parse(String(row.public_key));
    } catch {
      throw new joseErrors.JWKSInvalid('Stored DanjiOn JWKS public key is not valid JSON');
    }
    if (typeof publicJwk !== 'object' || publicJwk === null || Array.isArray(publicJwk)) {
      throw new joseErrors.JWKSInvalid('Stored DanjiOn JWKS public key is not a JSON object');
    }
    keys.push({
      alg: row.alg == null ? 'EdDSA' : String(row.alg),
      crv: row.crv == null ? undefined : String(row.crv),
      ...(publicJwk as Record<string, unknown>),
      kid: String(row.id)
    });
  }
  return createLocalJWKSet({ keys });
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
  payload: JWTPayload
): Promise<ActorResolution> {
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) return null;

  // Account existence is intentionally separate from resident authority. Any
  // authenticated Better Auth identity may bootstrap a normal product account;
  // resident-only handlers still require a verified household membership.
  const existing = await actorBySubject(sql, subject);
  if (existing) return existing;

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

type JwtVerificationErrorCode =
  | 'AUTH_JWT_SIGNATURE_INVALID'
  | 'AUTH_JWT_ISSUER_INVALID'
  | 'AUTH_JWT_AUDIENCE_INVALID'
  | 'AUTH_JWT_EXPIRED'
  | 'AUTH_JWT_ALG_INVALID'
  | 'AUTH_JWT_KEY_NOT_FOUND'
  | 'AUTH_JWT_KEY_AMBIGUOUS'
  | 'AUTH_JWT_JWKS_TIMEOUT'
  | 'AUTH_JWT_JWKS_INVALID'
  | 'AUTH_JWT_MALFORMED'
  | 'AUTH_JWT_NOT_YET_VALID'
  | 'AUTH_JWT_CLAIM_INVALID'
  | 'AUTH_INVALID';

type JwtVerificationResult =
  | { payload: JWTPayload; errorCode: null }
  | { payload: null; errorCode: JwtVerificationErrorCode };

function joseErrorField(error: unknown, field: 'code' | 'claim'): string {
  return typeof error === 'object' && error !== null && field in error
    ? String((error as Record<string, unknown>)[field] ?? '')
    : '';
}

export function jwtVerificationErrorCode(error: unknown): JwtVerificationErrorCode {
  const code = joseErrorField(error, 'code');
  const claim = joseErrorField(error, 'claim');

  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'AUTH_JWT_SIGNATURE_INVALID';
  if (code === 'ERR_JWT_EXPIRED') return 'AUTH_JWT_EXPIRED';
  if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') return 'AUTH_JWT_ALG_INVALID';
  if (code === 'ERR_JWKS_NO_MATCHING_KEY') return 'AUTH_JWT_KEY_NOT_FOUND';
  if (code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS') return 'AUTH_JWT_KEY_AMBIGUOUS';
  if (code === 'ERR_JWKS_TIMEOUT') return 'AUTH_JWT_JWKS_TIMEOUT';
  if (code === 'ERR_JWKS_INVALID' || code === 'ERR_JWK_INVALID') return 'AUTH_JWT_JWKS_INVALID';
  if (code === 'ERR_JWT_INVALID' || code === 'ERR_JWS_INVALID') return 'AUTH_JWT_MALFORMED';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (claim === 'iss') return 'AUTH_JWT_ISSUER_INVALID';
    if (claim === 'aud') return 'AUTH_JWT_AUDIENCE_INVALID';
    if (claim === 'nbf') return 'AUTH_JWT_NOT_YET_VALID';
    if (claim) return 'AUTH_JWT_CLAIM_INVALID';
  }
  return 'AUTH_INVALID';
}

async function verifyToken(
  token: string,
  config: AuthConfig,
  requestId: string,
  sql: Sql
): Promise<JwtVerificationResult> {
  try {
    const keyResolver: JwksResolver = config.jwksSource === 'local'
      ? await danjionLocalJwks(sql)
      : remoteJwks(config.jwksUrl);
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['EdDSA']
    });
    return { payload, errorCode: null };
  } catch (error) {
    // Sanitized diagnostic only: request id plus JOSE error class fields.
    // Never log the token, headers, cookies, claim payload, or key material.
    console.warn('[DanjiOn JWT Verify]', JSON.stringify({
      requestId,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorCode: joseErrorField(error, 'code'),
      errorClaim: joseErrorField(error, 'claim')
    }));
    return { payload: null, errorCode: jwtVerificationErrorCode(error) };
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

  const verification = await verifyToken(token, config, requestId, sql);
  if (!verification.payload) {
    return fail(verification.errorCode, 'Invalid or expired authentication token', 401, requestId);
  }
  const payload = verification.payload;

  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) return fail('AUTH_JWT_SUBJECT_MISSING', 'Authenticated subject is missing', 401, requestId);
  if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== subject) {
    return fail('AUTH_JWT_SUBJECT_INCONSISTENT', 'Authenticated subject is inconsistent', 401, requestId);
  }
  if (payload.banned === true) return fail('AUTH_FORBIDDEN', 'Authenticated user is blocked', 403, requestId);

  try {
    const actor = await resolveOrBootstrapActor(sql, payload);
    if (actor === 'closed') return fail('AUTH_ACCOUNT_CLOSED', 'DanjiOn product account is closed', 403, requestId);
    if (!actor) return fail('AUTH_IDENTITY_LINK_FAILED', 'Authenticated user could not be linked', 500, requestId);
    return actor;
  } catch (error) {
    console.error('[DanjiOn Auth Link]', requestId, error instanceof Error ? error.name : 'identity_link_failed');
    return fail('AUTH_IDENTITY_LINK_FAILED', 'Authenticated user could not be linked', 500, requestId);
  }
}
