import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { requireVerifiedResident, type VerifiedResident } from './authorization-v2';
import { requireActor } from './auth-v1';
import type { CoreEnv } from './core-v1';
import { resolvePadiemAuthority } from './padiem-authority-v1';

type Sql = NeonQueryFunction<false, false>;

const REQUEST_ID_HEADER = 'x-danjion-request-id';
const MAX_BODY_BYTES = 16 * 1024;
const MAX_NICKNAME_CHARS = 40;
const MAX_BIO_CHARS = 300;
const MAX_AVATAR_URL_CHARS = 500;
const NICKNAME_CHANGE_COOLDOWN_DAYS = 30;
const NICKNAME_CHANGE_COOLDOWN_MS = NICKNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_LABEL = 'verified_resident';
const OPERATOR_PROFILE_LABEL = 'operator';
const ACCOUNT_PROFILE_LABEL = 'account';
const RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident.verification.exempt';

type PublicProfileRow = {
  id: unknown;
  display_name: unknown;
  avatar_url: unknown;
  joined_month: unknown;
  public_bio: unknown;
  is_discoverable: unknown;
  public_activity_count: unknown;
  nickname_changed_at: unknown;
};

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

function nicknameCooldownFail(nextAllowedAt: string, requestId: string): Response {
  return json({
    error: {
      code: 'NICKNAME_CHANGE_COOLDOWN',
      message: 'Nickname can be changed once every 30 days',
      nextAllowedAt
    },
    requestId
  }, 409, requestId);
}

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sqlFor(env: CoreEnv): Sql {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}

function canonicalUuid(value: string | undefined): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID.test(text) ? text : null;
}

async function bodyJson(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return fail('CONTENT_TYPE_REQUIRED', 'application/json required', 415, requestId);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 'Payload too large', 413, requestId);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || '{}');
  } catch {
    return fail('INVALID_JSON', 'Invalid JSON', 400, requestId);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('INVALID_JSON', 'JSON object required', 400, requestId);
  }
  return parsed as Record<string, unknown>;
}

function avatarValue(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  if (text.length > MAX_AVATAR_URL_CHARS) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function isBlocked(sql: Sql, leftUserId: string, rightUserId: string): Promise<boolean> {
  const rows = await sql`
    select 1
    from blocks
    where (blocker_user_id = ${leftUserId}::uuid and blocked_user_id = ${rightUserId}::uuid)
       or (blocker_user_id = ${rightUserId}::uuid and blocked_user_id = ${leftUserId}::uuid)
    limit 1
  `;
  return Boolean(rows[0]);
}

async function loadPublicProfile(sql: Sql, userId: string, complexId: string): Promise<PublicProfileRow | null> {
  const rows = await sql`
    select
      u.id,
      u.display_name,
      u.avatar_url,
      to_char(u.created_at at time zone 'UTC', 'YYYY-MM') as joined_month,
      coalesce(p.public_bio, '') as public_bio,
      (
        select max(ae.created_at)
        from audit_events ae
        where ae.actor_user_id = u.id
          and ae.action = 'resident.profile.nickname.change'
          and ae.decision = 'recorded'
      ) as nickname_changed_at,
      coalesce(p.is_discoverable, true) as is_discoverable,
      (
        (select count(*)
         from community_posts cp
         where cp.author_user_id = u.id
           and cp.complex_id = ${complexId}::uuid
           and cp.status = 'published'
           and cp.visibility = 'verified_residents')
        +
        (select count(*)
         from community_comments cc
         join community_posts parent_post
           on parent_post.id = cc.post_id
          and parent_post.complex_id = cc.complex_id
         where cc.author_user_id = u.id
           and cc.complex_id = ${complexId}::uuid
           and cc.status = 'published'
           and parent_post.status = 'published'
           and parent_post.visibility = 'verified_residents')
        +
        (select count(*)
         from business_reviews br
         join businesses b on b.id = br.business_id
         join business_complex_relations bcr
           on bcr.business_id = br.business_id
          and bcr.complex_id = br.complex_id
         where br.author_user_id = u.id
           and br.complex_id = ${complexId}::uuid
           and br.status = 'active'
           and b.status = 'approved'
           and bcr.verification_status = 'verified')
      )::int as public_activity_count
    from app_users u
    left join resident_public_profiles p on p.user_id = u.id
    where u.id = ${userId}::uuid
      and u.account_status = 'active'
      and exists (
        select 1
        from household_memberships hm
        join households h on h.id = hm.household_id and h.complex_id = hm.complex_id
        join complex_units cu on cu.id = h.complex_unit_id and cu.complex_id = h.complex_id
        where hm.user_id = u.id
          and hm.complex_id = ${complexId}::uuid
          and hm.status = 'verified'
          and h.status = 'active'
          and cu.status = 'active'
      )
    limit 1
  `;
  return (rows[0] as PublicProfileRow | undefined) ?? null;
}

async function loadOwnAccountProfile(sql: Sql, userId: string): Promise<PublicProfileRow | null> {
  const rows = await sql`
    select
      u.id,
      u.display_name,
      u.avatar_url,
      to_char(u.created_at at time zone 'UTC', 'YYYY-MM') as joined_month,
      coalesce(p.public_bio, '') as public_bio,
      (
        select max(ae.created_at)
        from audit_events ae
        where ae.actor_user_id = u.id
          and ae.action = 'resident.profile.nickname.change'
          and ae.decision = 'recorded'
      ) as nickname_changed_at,
      coalesce(p.is_discoverable, true) as is_discoverable,
      0::int as public_activity_count
    from app_users u
    left join resident_public_profiles p on p.user_id = u.id
    where u.id = ${userId}::uuid
      and u.account_status = 'active'
    limit 1
  `;
  return (rows[0] as PublicProfileRow | undefined) ?? null;
}

function presentProfile(row: PublicProfileRow): Record<string, unknown> {
  const publicActivityCount = Number(row.public_activity_count ?? 0);
  return {
    userId: String(row.id),
    nickname: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    residentLabel: PROFILE_LABEL,
    joinedMonth: String(row.joined_month),
    publicBio: String(row.public_bio ?? ''),
    publicActivityCount: Number.isFinite(publicActivityCount) && publicActivityCount > 0 ? Math.floor(publicActivityCount) : 0
  };
}

function presentOwnProfile(row: PublicProfileRow, profileLabel: string): Record<string, unknown> {
  const changedAt = isoDate(row.nickname_changed_at);
  const nextAllowedAt = changedAt
    ? new Date(new Date(changedAt).getTime() + NICKNAME_CHANGE_COOLDOWN_MS).toISOString()
    : null;
  return {
    ...presentProfile(row),
    residentLabel: profileLabel,
    nicknameChangedAt: changedAt,
    nicknameCanChangeAt: nextAllowedAt
  };
}

async function viewerForComplex(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<VerifiedResident | Response> {
  if (!complexSlug) return fail('VALIDATION_ERROR', 'complexSlug is required', 400, requestId);
  return requireVerifiedResident(request, env, sql, requestId, complexSlug);
}

type OwnProfileViewer = {
  id: string;
  complexId: string | null;
  profileLabel: string;
};

async function viewerForOwnProfile(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<OwnProfileViewer | Response> {
  const resident = await viewerForComplex(request, env, sql, requestId, complexSlug);
  if (!(resident instanceof Response)) {
    // #920: requireVerifiedResident admits exempt/temporary/ordinary actors
    // with residentVerificationExempt=true and householdId=null while still
    // returning the requested complexId. loadPublicProfile would then require
    // a verified household row and 404. Exempt self must take the account-safe
    // path (complexId=null → loadOwnAccountProfile); public other-profile
    // lookups stay on getProfile()/viewerForComplex unchanged.
    if (resident.residentVerificationExempt) {
      return { id: resident.id, complexId: null, profileLabel: OPERATOR_PROFILE_LABEL };
    }
    return { id: resident.id, complexId: resident.complexId, profileLabel: PROFILE_LABEL };
  }
  if (resident.status !== 403) return resident;

  const actor = await requireActor(request, env, sql, requestId);
  if (actor instanceof Response) return actor;
  try {
    const authority = await resolvePadiemAuthority(sql, actor.id);
    if (authority.scopes.includes(RESIDENT_VERIFICATION_EXEMPT_SCOPE)) {
      return { id: actor.id, complexId: null, profileLabel: OPERATOR_PROFILE_LABEL };
    }
    // Own-account profile is intentionally available before household/resident
    // verification so a newly authenticated social/email account can choose a
    // DanjiOn nickname during onboarding. Public profile lookup and resident-only
    // activity remain guarded by requireVerifiedResident().
    return { id: actor.id, complexId: null, profileLabel: ACCOUNT_PROFILE_LABEL };
  } catch {
    return fail('AUTHORITY_DB_ERROR', 'Authorization could not be verified', 503, requestId);
  }
}

async function loadOwnProfile(sql: Sql, viewer: OwnProfileViewer): Promise<PublicProfileRow | null> {
  return viewer.complexId
    ? loadPublicProfile(sql, viewer.id, viewer.complexId)
    : loadOwnAccountProfile(sql, viewer.id);
}

async function getProfile(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  targetUserId: string,
  complexSlug: string
): Promise<Response> {
  const viewer = await viewerForComplex(request, env, sql, requestId, complexSlug);
  if (viewer instanceof Response) return viewer;
  const isSelf = targetUserId === viewer.id.toLowerCase();
  if (!isSelf && await isBlocked(sql, viewer.id, targetUserId)) {
    return fail('PROFILE_NOT_FOUND', 'Profile not found', 404, requestId);
  }
  const row = await loadPublicProfile(sql, targetUserId, viewer.complexId);
  if (!row || (!isSelf && row.is_discoverable !== true)) {
    return fail('PROFILE_NOT_FOUND', 'Profile not found', 404, requestId);
  }
  return ok(presentProfile(row), requestId);
}

async function updateOwnProfile(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string,
  complexSlug: string
): Promise<Response> {
  const viewer = await viewerForOwnProfile(request, env, sql, requestId, complexSlug);
  if (viewer instanceof Response) return viewer;
  const payload = await bodyJson(request, requestId);
  if (payload instanceof Response) return payload;

  const allowed = new Set(['nickname', 'avatarUrl', 'publicBio']);
  const keys = Object.keys(payload);
  if (!keys.length || keys.some((key) => !allowed.has(key))) {
    return fail('VALIDATION_ERROR', 'Only nickname, avatarUrl, and publicBio may be updated', 400, requestId);
  }

  const current = await loadOwnProfile(sql, viewer);
  if (!current) return fail('PROFILE_NOT_FOUND', 'Profile not found', 404, requestId);

  let nickname = String(current.display_name);
  if (payload.nickname !== undefined) {
    if (typeof payload.nickname !== 'string') {
      return fail('VALIDATION_ERROR', 'nickname must be a string', 400, requestId);
    }
    nickname = payload.nickname.trim();
    if (!nickname || nickname.length > MAX_NICKNAME_CHARS) {
      return fail('VALIDATION_ERROR', `nickname must be 1-${MAX_NICKNAME_CHARS} characters`, 400, requestId);
    }
  }
  const nicknameChanged = payload.nickname !== undefined && nickname !== String(current.display_name);
  if (nicknameChanged) {
    const lastChangedAt = isoDate(current.nickname_changed_at);
    if (lastChangedAt) {
      const nextAllowed = new Date(new Date(lastChangedAt).getTime() + NICKNAME_CHANGE_COOLDOWN_MS);
      if (nextAllowed.getTime() > Date.now()) {
        return nicknameCooldownFail(nextAllowed.toISOString(), requestId);
      }
    }
  }

  let avatarUrl = current.avatar_url ? String(current.avatar_url) : null;
  if (payload.avatarUrl !== undefined) {
    const parsedAvatar = avatarValue(payload.avatarUrl);
    if (parsedAvatar === undefined) {
      return fail('VALIDATION_ERROR', 'avatarUrl must be null or a valid HTTPS URL', 400, requestId);
    }
    avatarUrl = parsedAvatar;
  }

  let publicBio = String(current.public_bio ?? '');
  if (payload.publicBio !== undefined) {
    if (typeof payload.publicBio !== 'string') {
      return fail('VALIDATION_ERROR', 'publicBio must be a string', 400, requestId);
    }
    publicBio = payload.publicBio.trim();
    if (publicBio.length > MAX_BIO_CHARS) {
      return fail('VALIDATION_ERROR', `publicBio must be at most ${MAX_BIO_CHARS} characters`, 400, requestId);
    }
  }

  const profileWrite = sql`
    insert into resident_public_profiles (user_id, public_bio)
    values (${viewer.id}::uuid, ${publicBio})
    on conflict (user_id) do update
    set public_bio = excluded.public_bio
  `;
  const writes = [
    sql`
      update app_users
      set display_name = ${nickname}, avatar_url = ${avatarUrl}, updated_at = now()
      where id = ${viewer.id}::uuid and account_status = 'active'
    `,
    profileWrite
  ];
  if (nicknameChanged) {
    const auditWrite = viewer.complexId
      ? sql`
          insert into audit_events (
            request_id, actor_user_id, actor_kind, complex_id, action, scope,
            resource_type, resource_id, decision, reason_code, metadata
          ) values (
            ${requestId}, ${viewer.id}::uuid, 'user', ${viewer.complexId}::uuid,
            'resident.profile.nickname.change', 'resident.profile',
            'app_user', ${viewer.id}, 'recorded', 'NICKNAME_CHANGED', '{}'::jsonb
          )
        `
      : sql`
          insert into audit_events (
            request_id, actor_user_id, actor_kind, complex_id, action, scope,
            resource_type, resource_id, decision, reason_code, metadata
          ) values (
            ${requestId}, ${viewer.id}::uuid, 'user', null,
            'resident.profile.nickname.change', 'resident.profile',
            'app_user', ${viewer.id}, 'recorded', 'NICKNAME_CHANGED', '{}'::jsonb
          )
        `;
    writes.push(auditWrite);
  }

  await sql.transaction(writes);

  const updated = await loadOwnProfile(sql, viewer);
  if (!updated) return fail('PROFILE_UPDATE_FAILED', 'Profile could not be loaded after update', 500, requestId);
  return ok(presentOwnProfile(updated, viewer.profileLabel), requestId);
}

export async function handleResidentProfileWithSql(
  request: Request,
  env: CoreEnv,
  sql: Sql,
  requestId: string
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const complexSlug = url.searchParams.get('complexSlug')?.trim() || '';

  if (path === '/api/v1/me/profile') {
    if (request.method === 'GET') {
      const viewer = await viewerForOwnProfile(request, env, sql, requestId, complexSlug);
      if (viewer instanceof Response) return viewer;
      const row = await loadOwnProfile(sql, viewer);
      if (!row) return fail('PROFILE_NOT_FOUND', 'Profile not found', 404, requestId);
      return ok(presentOwnProfile(row, viewer.profileLabel), requestId);
    }
    if (request.method === 'PATCH') return updateOwnProfile(request, env, sql, requestId, complexSlug);
    return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
  }

  const match = path.match(/^\/api\/v1\/profiles\/([0-9a-fA-F-]+)$/);
  if (match) {
    const targetUserId = canonicalUuid(match[1]);
    if (!targetUserId) return fail('VALIDATION_ERROR', 'Invalid profile user id', 400, requestId);
    if (request.method !== 'GET') return fail('METHOD_NOT_ALLOWED', 'Method not allowed', 405, requestId);
    return getProfile(request, env, sql, requestId, targetUserId, complexSlug);
  }

  return null;
}

export async function handleResidentProfileRequest(
  request: Request,
  env: CoreEnv,
  requestId: string
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/profile' && !path.startsWith('/api/v1/profiles/')) return null;
  return handleResidentProfileWithSql(request, env, sqlFor(env), requestId);
}
