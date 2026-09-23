import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { CoreEnv } from './core-v1';
import {
  driveConfigured,
  fail,
  metadataMatches,
  parseObjectKey,
  readDriveMetadata,
  requiredDriveCredentials,
  type DriveEnv,
  type DriveMetadata
} from './storage-v1';
import { r2Enabled, r2Head, type R2StorageEnv } from './storage-r2-v1';

type Sql = NeonQueryFunction<false, false>;

/**
 * Canonical shared validation for DanjiOn public business image references.
 * Extracted out of the storage route owner (storage-v1) so application and
 * admin lanes consume a shared reference module instead of a route file
 * (#372 BE-S1, #375 F1). Behavior is byte-identical to the former
 * storage-v1 implementation: 503 when Drive is unconfigured, 400 for a
 * malformed or non-public/non-business-image reference, 503 when storage
 * cannot be re-verified, 403 when uploader/complex ownership does not match.
 */
export async function validateBusinessImageReference(
  env: CoreEnv,
  objectKeyValue: string,
  expectedUploaderUserId: string,
  expectedComplexSlug: string,
  requestId: string
): Promise<Response | null> {
  const driveEnv = env as DriveEnv;
  // #809: in R2 mode the same identity contract is verified through the R2
  // binding, so a Drive credential gate must not reject a valid R2 object.
  // Drive mode keeps the original gate byte-for-byte.
  const r2Mode = r2Enabled(env as R2StorageEnv);
  if (!r2Mode && (!driveConfigured(driveEnv) || !requiredDriveCredentials(driveEnv))) {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage is not configured for business image verification', 503, requestId);
  }

  const parsed = parseObjectKey(objectKeyValue);
  if (!parsed || parsed.visibility !== 'public' || parsed.kind !== 'business-image') {
    return fail(
      'INVALID_BUSINESS_IMAGE_REFERENCE',
      'Representative image must reference a DanjiOn public business image',
      400,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = r2Mode
      ? await r2Head(env as R2StorageEnv, parsed.kind, parsed.fileId)
      : await readDriveMetadata(driveEnv, parsed);
  } catch {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_UNAVAILABLE',
      'Representative image could not be verified against storage',
      503,
      requestId
    );
  }
  if (!metadata || !metadataMatches(driveEnv, parsed, metadata, r2Mode)) {
    return fail(
      'INVALID_BUSINESS_IMAGE_REFERENCE',
      'Representative image is missing or no longer a valid DanjiOn business image',
      400,
      requestId
    );
  }

  const props = metadata.appProperties || {};
  if (props.danjionUploaderUserId !== expectedUploaderUserId || props.danjionComplexSlug !== expectedComplexSlug) {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_FORBIDDEN',
      'Representative image does not belong to this resident and complex',
      403,
      requestId
    );
  }
  return null;
}

/**
 * #844: canonical reference validation for official apartment-news public images.
 *
 * The post create/patch endpoint must never trust a client-supplied object key. A key is accepted
 * only when it is a public official-news-image with an ACTIVE lifecycle registry row for the very
 * complex the post belongs to, and Drive independently confirms the same identity/metadata.
 *
 * Uploader identity is deliberately NOT required here (Amendment B): an authorized operator may
 * upload and a different authorized operator may attach it, as long as the complex matches.
 */
export async function validateOfficialNewsImageReference(
  env: CoreEnv,
  sql: Sql,
  objectKeyValue: string,
  expectedComplexId: string,
  expectedComplexSlug: string,
  requestId: string
): Promise<Response | null> {
  const driveEnv = env as DriveEnv;
  if (!driveConfigured(driveEnv) || !requiredDriveCredentials(driveEnv)) {
    return fail('STORAGE_NOT_CONFIGURED', 'Google Drive storage is not configured for official news image verification', 503, requestId);
  }

  const parsed = parseObjectKey(objectKeyValue);
  if (!parsed || parsed.visibility !== 'public' || parsed.kind !== 'official-news-image') {
    return fail(
      'INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE',
      'Attachment must reference a DanjiOn public official-news image',
      400,
      requestId
    );
  }

  // Registry is the server authority for kind/state/complex. Raw prefix inspection is not enough.
  let registryRows;
  try {
    registryRows = await sql`
      select uploader_user_id::text, complex_id::text, state, kind
      from business_image_objects
      where object_key = ${parsed.objectKey}
      limit 1
    `;
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REGISTRY_UNAVAILABLE',
      'Official news image could not be verified against the lifecycle registry',
      503,
      requestId
    );
  }
  const registry = registryRows[0] as { uploader_user_id?: string; complex_id?: string; state?: string; kind?: string } | undefined;
  if (!registry || registry.kind !== 'official-news-image') {
    return fail(
      'INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE',
      'Attachment is not a registered official-news image',
      400,
      requestId
    );
  }
  if (String(registry.complex_id) !== expectedComplexId) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REFERENCE_FORBIDDEN',
      'Official news image does not belong to this complex',
      403,
      requestId
    );
  }
  if (String(registry.state) !== 'active') {
    return fail(
      'OFFICIAL_NEWS_IMAGE_NOT_ACTIVE',
      'Official news image is not in an active state',
      409,
      requestId
    );
  }

  let metadata: DriveMetadata | null;
  try {
    metadata = await readDriveMetadata(driveEnv, parsed);
  } catch {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REFERENCE_UNAVAILABLE',
      'Official news image could not be verified against storage',
      503,
      requestId
    );
  }
  if (!metadata || !metadataMatches(driveEnv, parsed, metadata)) {
    return fail(
      'INVALID_OFFICIAL_NEWS_IMAGE_REFERENCE',
      'Official news image is missing or no longer a valid DanjiOn official-news image',
      400,
      requestId
    );
  }

  const props = metadata.appProperties || {};
  if (props.danjionComplexSlug !== expectedComplexSlug) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REFERENCE_FORBIDDEN',
      'Official news image storage metadata does not match this complex',
      403,
      requestId
    );
  }
  // BLOCKER 4: the registry uploader must equal the Drive-recorded uploader. The post editor does
  // not have to be the uploader (SAME_UPLOADER_REQUIRED=NO), but the two server-side identities
  // that describe one object must agree.
  if (String(registry.uploader_user_id ?? '') !== String(props.danjionUploaderUserId ?? '')) {
    return fail(
      'OFFICIAL_NEWS_IMAGE_REFERENCE_FORBIDDEN',
      'Official news image registry uploader does not match its storage metadata',
      403,
      requestId
    );
  }
  return null;
}
