import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';

type Sql = NeonQueryFunction<false, false>;

type ReconciliationEnv = CoreEnv & {
  STORAGE_MODE?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?: string;
};

export type BusinessImageReconciliationClaim = {
  object_key: string;
  uploader_user_id: string;
  complex_id: string;
  complex_slug: string;
  state: 'upload_pending' | 'delete_pending';
  reconcile_attempt_count: number;
};

type DriveMetadata = {
  id: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
};

export type BusinessImageReconciliationOutcome = 'activated' | 'retired' | 'deferred' | 'stale';

export type BusinessImageReconciliationSummary = {
  skipped: boolean;
  claimed: number;
  activated: number;
  retired: number;
  deferred: number;
  stale: number;
  errors: number;
};

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const BUSINESS_IMAGE_PREFIX = 'gdrive/public/business-image/';
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_BATCH_SIZE = 25;
const LEASE_SECONDS = 5 * 60;
let cachedAccessToken: { value: string; expiresAt: number } | null = null;

function requiredDriveCredentials(env: ReconciliationEnv): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function reconciliationConfigured(env: ReconciliationEnv): boolean {
  return env.STORAGE_MODE === 'drive'
    && Boolean(env.DATABASE_URL)
    && Boolean(env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim())
    && Boolean(requiredDriveCredentials(env));
}

async function accessToken(env: ReconciliationEnv): Promise<string> {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) return cachedAccessToken.value;
  const credentials = requiredDriveCredentials(env);
  if (!credentials) throw new Error('Google Drive OAuth credentials are not configured');

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Google OAuth refresh failed (${response.status})`);
  }
  cachedAccessToken = {
    value: payload.access_token,
    expiresAt: now + Math.max(300, Number(payload.expires_in || 3600)) * 1000
  };
  return cachedAccessToken.value;
}

async function googleFetch(env: ReconciliationEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(env);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function fileIdFromObjectKey(objectKey: string): string | null {
  if (!objectKey.startsWith(BUSINESS_IMAGE_PREFIX)) return null;
  const fileId = objectKey.slice(BUSINESS_IMAGE_PREFIX.length);
  return DRIVE_FILE_ID.test(fileId) ? fileId : null;
}

function metadataIdentityMatches(
  env: ReconciliationEnv,
  claim: BusinessImageReconciliationClaim,
  fileId: string,
  metadata: DriveMetadata
): boolean {
  const folderId = env.GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID?.trim();
  const props = metadata.appProperties || {};
  return Boolean(folderId)
    && metadata.id === fileId
    && metadata.parents?.includes(folderId!) === true
    && props.danjionKind === 'business-image'
    && props.danjionVisibility === 'public'
    && props.danjionUploaderUserId === claim.uploader_user_id
    && props.danjionComplexSlug === claim.complex_slug;
}

async function readDriveMetadata(env: ReconciliationEnv, fileId: string): Promise<DriveMetadata | null> {
  const response = await googleFetch(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,trashed,parents,appProperties&supportsAllDrives=true`
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Drive metadata read failed (${response.status})`);
  return response.json() as Promise<DriveMetadata>;
}

async function trashDriveFile(env: ReconciliationEnv, fileId: string): Promise<DriveMetadata | null> {
  const response = await googleFetch(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,trashed,parents,appProperties&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Drive trash failed (${response.status})`);
  return response.json() as Promise<DriveMetadata>;
}

export function reconciliationBackoffSeconds(attemptCount: number): number {
  if (attemptCount <= 1) return 60;
  if (attemptCount === 2) return 5 * 60;
  if (attemptCount === 3) return 15 * 60;
  if (attemptCount === 4) return 60 * 60;
  return 6 * 60 * 60;
}

export async function claimBusinessImageReconciliationBatch(
  sql: Sql,
  leaseToken: string,
  requestedLimit = MAX_BATCH_SIZE
): Promise<BusinessImageReconciliationClaim[]> {
  const limit = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.trunc(requestedLimit)));
  const rows = await sql`
    with candidates as (
      select bio.object_key
      from business_image_objects bio
      where bio.state in ('upload_pending', 'delete_pending')
        and bio.updated_at <= now() - interval '2 minutes'
        and (bio.reconcile_next_attempt_at is null or bio.reconcile_next_attempt_at <= now())
        and (bio.reconcile_lease_expires_at is null or bio.reconcile_lease_expires_at <= now())
      order by coalesce(bio.reconcile_next_attempt_at, bio.updated_at), bio.updated_at, bio.object_key
      limit ${limit}
      for update skip locked
    ), claimed as (
      update business_image_objects bio
      set reconcile_lease_token = ${leaseToken}::uuid,
          reconcile_lease_expires_at = now() + (${LEASE_SECONDS} * interval '1 second'),
          reconcile_attempt_count = bio.reconcile_attempt_count + 1,
          reconcile_last_attempt_at = now(),
          updated_at = now()
      from candidates c
      where bio.object_key = c.object_key
      returning bio.object_key,
                bio.uploader_user_id::text as uploader_user_id,
                bio.complex_id,
                bio.state,
                bio.reconcile_attempt_count
    )
    select claimed.object_key,
           claimed.uploader_user_id,
           claimed.complex_id::text as complex_id,
           c.slug as complex_slug,
           claimed.state,
           claimed.reconcile_attempt_count
    from claimed
    join complexes c on c.id = claimed.complex_id
    order by claimed.object_key
  `;
  return rows as BusinessImageReconciliationClaim[];
}

async function finalizeUploadActive(
  sql: Sql,
  claim: BusinessImageReconciliationClaim,
  leaseToken: string
): Promise<boolean> {
  const rows = await sql`
    update business_image_objects
    set state = 'active',
        reconcile_lease_token = null,
        reconcile_lease_expires_at = null,
        reconcile_next_attempt_at = null,
        reconcile_last_error_code = null,
        updated_at = now()
    where object_key = ${claim.object_key}
      and state = 'upload_pending'
      and reconcile_lease_token = ${leaseToken}::uuid
    returning state
  `;
  return Boolean(rows[0]);
}

async function finalizeDeleteRetired(
  sql: Sql,
  claim: BusinessImageReconciliationClaim,
  leaseToken: string
): Promise<boolean> {
  const rows = await sql`
    update business_image_objects
    set state = 'retired',
        retired_at = coalesce(retired_at, now()),
        reconcile_lease_token = null,
        reconcile_lease_expires_at = null,
        reconcile_next_attempt_at = null,
        reconcile_last_error_code = null,
        updated_at = now()
    where object_key = ${claim.object_key}
      and state = 'delete_pending'
      and reconcile_lease_token = ${leaseToken}::uuid
    returning state
  `;
  return Boolean(rows[0]);
}

async function deferClaim(
  sql: Sql,
  claim: BusinessImageReconciliationClaim,
  leaseToken: string,
  errorCode: string
): Promise<boolean> {
  const delaySeconds = reconciliationBackoffSeconds(claim.reconcile_attempt_count);
  const rows = await sql`
    update business_image_objects
    set reconcile_lease_token = null,
        reconcile_lease_expires_at = null,
        reconcile_next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
        reconcile_last_error_code = ${errorCode},
        updated_at = now()
    where object_key = ${claim.object_key}
      and state = ${claim.state}
      and reconcile_lease_token = ${leaseToken}::uuid
    returning state
  `;
  return Boolean(rows[0]);
}

async function deferOutcome(
  sql: Sql,
  claim: BusinessImageReconciliationClaim,
  leaseToken: string,
  errorCode: string
): Promise<BusinessImageReconciliationOutcome> {
  return await deferClaim(sql, claim, leaseToken, errorCode) ? 'deferred' : 'stale';
}

export async function reconcileClaimedBusinessImage(
  env: ReconciliationEnv,
  sql: Sql,
  claim: BusinessImageReconciliationClaim,
  leaseToken: string
): Promise<BusinessImageReconciliationOutcome> {
  const fileId = fileIdFromObjectKey(claim.object_key);
  if (!fileId) return deferOutcome(sql, claim, leaseToken, 'INVALID_OBJECT_KEY');

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(env, fileId);
  } catch {
    return deferOutcome(sql, claim, leaseToken, 'DRIVE_METADATA_UNAVAILABLE');
  }

  if (claim.state === 'upload_pending') {
    if (!metadata) return deferOutcome(sql, claim, leaseToken, 'UPLOAD_OBJECT_NOT_FOUND');
    if (metadata.trashed === true || !metadataIdentityMatches(env, claim, fileId, metadata)) {
      return deferOutcome(sql, claim, leaseToken, 'UPLOAD_METADATA_MISMATCH');
    }
    return await finalizeUploadActive(sql, claim, leaseToken) ? 'activated' : 'stale';
  }

  if (claim.state !== 'delete_pending') {
    return deferOutcome(sql, claim, leaseToken, 'UNSUPPORTED_PENDING_STATE');
  }

  if (!metadata) {
    return await finalizeDeleteRetired(sql, claim, leaseToken) ? 'retired' : 'stale';
  }
  if (!metadataIdentityMatches(env, claim, fileId, metadata)) {
    return deferOutcome(sql, claim, leaseToken, 'DELETE_METADATA_MISMATCH');
  }
  if (metadata.trashed === true) {
    return await finalizeDeleteRetired(sql, claim, leaseToken) ? 'retired' : 'stale';
  }

  try {
    const patched = await trashDriveFile(env, fileId);
    if (!patched) {
      return await finalizeDeleteRetired(sql, claim, leaseToken) ? 'retired' : 'stale';
    }
  } catch {
    return deferOutcome(sql, claim, leaseToken, 'DRIVE_TRASH_UNAVAILABLE');
  }

  let confirmed: DriveMetadata | null;
  try {
    confirmed = await readDriveMetadata(env, fileId);
  } catch {
    return deferOutcome(sql, claim, leaseToken, 'DRIVE_TRASH_CONFIRMATION_UNAVAILABLE');
  }
  if (!confirmed) {
    return await finalizeDeleteRetired(sql, claim, leaseToken) ? 'retired' : 'stale';
  }
  if (!metadataIdentityMatches(env, claim, fileId, confirmed) || confirmed.trashed !== true) {
    return deferOutcome(sql, claim, leaseToken, 'DELETE_CONFIRMATION_MISMATCH');
  }
  return await finalizeDeleteRetired(sql, claim, leaseToken) ? 'retired' : 'stale';
}

export async function runBusinessImageLifecycleReconciliation(
  env: ReconciliationEnv
): Promise<BusinessImageReconciliationSummary> {
  const summary: BusinessImageReconciliationSummary = {
    skipped: false,
    claimed: 0,
    activated: 0,
    retired: 0,
    deferred: 0,
    stale: 0,
    errors: 0
  };

  if (env.APP_ENV !== 'production') {
    summary.skipped = true;
    return summary;
  }
  if (!reconciliationConfigured(env)) {
    throw new Error('Business image background reconciliation is not fully configured');
  }

  const sql: Sql = neon(env.DATABASE_URL);
  const leaseToken = crypto.randomUUID();
  const claims = await claimBusinessImageReconciliationBatch(sql, leaseToken, MAX_BATCH_SIZE);
  summary.claimed = claims.length;

  for (const claim of claims) {
    try {
      const outcome = await reconcileClaimedBusinessImage(env, sql, claim, leaseToken);
      summary[outcome] += 1;
    } catch {
      // A database-side failure may prevent even defer metadata from being written.
      // The finite lease still expires, so a later scheduled run may reclaim it.
      summary.errors += 1;
    }
  }

  return summary;
}
