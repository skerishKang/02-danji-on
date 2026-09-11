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
  if (!driveConfigured(driveEnv) || !requiredDriveCredentials(driveEnv)) {
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
    metadata = await readDriveMetadata(driveEnv, parsed);
  } catch {
    return fail(
      'BUSINESS_IMAGE_REFERENCE_UNAVAILABLE',
      'Representative image could not be verified against storage',
      503,
      requestId
    );
  }
  if (!metadata || !metadataMatches(driveEnv, parsed, metadata)) {
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
