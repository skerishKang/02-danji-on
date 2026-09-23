#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TARGET_URL_ENV = 'DANJION_RESTORE_DRILL_DB_URL';
const APPROVED_IDENTITY_ENV = 'DANJION_RESTORE_APPROVED_TARGET_SHA256';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
// This is a provider-shape check, not project identity discovery. The
// owner-approved fingerprint plus provider readback remains authoritative.
const NEON_ENDPOINT_HOST = /^ep-[a-z0-9-]+(?:-pooler)?\.[a-z0-9-]+\.aws\.neon\.tech$/i;
const FORBIDDEN_PROJECT_MARKERS = [
  'old-shape-61609481',
  'wispy-rain-16787448',
];
const CREDENTIAL_QUERY_KEYS = new Set([
  'password',
  'pass',
  'token',
  'secret',
  'sslpassword',
  'sslkey',
  'sslkeybase64',
  'sslcert',
  'sslrootcert',
  'sslcrl',
  'passfile',
]);

function identityError(reason) {
  const error = new Error(reason);
  error.reason = reason;
  throw error;
}

/**
 * Return a deterministic, credential-redacted identity for a PostgreSQL URL.
 * The URL itself and the resulting digest are never printed by this module.
 */
export function canonicalizeTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    identityError('MISSING_TARGET_URL');
  }
  if (rawUrl !== rawUrl.trim() || /[\u0000-\u001f\u007f]/.test(rawUrl)) {
    identityError('MALFORMED_TARGET_URL');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    identityError('MALFORMED_TARGET_URL');
  }

  if (
    !ALLOWED_PROTOCOLS.has(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.pathname ||
    parsed.pathname === '/' ||
    parsed.hash
  ) {
    identityError('MALFORMED_TARGET_URL');
  }
  if (!NEON_ENDPOINT_HOST.test(parsed.hostname)) {
    identityError('NON_NEON_TARGET');
  }
  if (FORBIDDEN_PROJECT_MARKERS.some((marker) => rawUrl.includes(marker))) {
    identityError('FORBIDDEN_TARGET_PROJECT');
  }

  const canonical = new URL(parsed.toString());
  canonical.username = '';
  canonical.password = '';

  const query = [...parsed.searchParams.entries()]
    .filter(([key]) => !CREDENTIAL_QUERY_KEYS.has(key.toLowerCase()))
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      if (aValue !== bValue) return aValue < bValue ? -1 : 1;
      return 0;
    });

  canonical.search = '';
  for (const [key, value] of query) canonical.searchParams.append(key, value);
  return canonical.toString();
}

export function fingerprintTarget(rawUrl) {
  return createHash('sha256').update(canonicalizeTarget(rawUrl), 'utf8').digest('hex');
}

export function verifyTarget(rawUrl, approvedIdentity) {
  if (typeof approvedIdentity !== 'string' || approvedIdentity.length === 0) {
    return { ok: false, reason: 'MISSING_APPROVED_IDENTITY' };
  }
  if (!SHA256_PATTERN.test(approvedIdentity)) {
    return { ok: false, reason: 'MALFORMED_APPROVED_IDENTITY' };
  }

  let actualIdentity;
  try {
    actualIdentity = fingerprintTarget(rawUrl);
  } catch (error) {
    return { ok: false, reason: error.reason ?? 'MALFORMED_TARGET_URL' };
  }

  if (actualIdentity !== approvedIdentity) {
    return { ok: false, reason: 'IDENTITY_MISMATCH' };
  }
  return { ok: true, reason: 'MATCH' };
}

function main() {
  const result = verifyTarget(
    process.env[TARGET_URL_ENV],
    process.env[APPROVED_IDENTITY_ENV],
  );

  if (!result.ok) {
    process.stderr.write(`RESTORE_TARGET_IDENTITY=FAIL reason=${result.reason}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('RESTORE_TARGET_IDENTITY=PASS\n');
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) main();
