/**
 * Shared helpers for the COMPARISON-ONLY React V2 runtime preview (#395).
 *
 * The preview bundle must never carry production authority. This module is the
 * single source of truth for (a) sanitizing the build environment and (b) the
 * registry record shape that KILO1's gateway (#397) consumes.
 */

export const PREVIEW_SUBPATH = '/v2-runtime/';
export const PREVIEW_OUT_DIR = 'dist-v2-runtime-preview';
export const PREVIEW_VERSION_NAME = 'v2-runtime-preview';
export const PREVIEW_STATUS = 'COMPARISON_ONLY';

// Env vars that could promote the bundle to live/production authority.
// They are DELETED from the child environment, never merely unset.
export const FORBIDDEN_PREVIEW_ENV = [
  'VITE_DATA_MODE',
  'VITE_AUTH_MODE',
  'VITE_STORAGE_MODE',
  'VITE_API_BASE_URL',
  'VITE_AUTH_BASE_URL',
  'VITE_COMPLEX_SLUG',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'NITROUS_BACKEND_ORIGIN',
  'NEON_CONNECTION_STRING',
  'NEON_PROJECT_ID',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL'
];

// Env vars the preview forces to safe, non-production values.
export const PREVIEW_SAFE_ENV = {
  VITE_UI_VARIANT: 'v2',
  VITE_V1_URL: '',
  VITE_V2_URL: '',
  VITE_GATEWAY_URL: ''
};

// Any built asset containing these substrings is a hard safety failure:
// the bundle must not reference production or live-preview hosts.
export const FORBIDDEN_BUNDLE_PATTERNS = [
  /\.pages\.dev/i,
  /\.workers\.dev/i,
  /danjion\.dev/i,
  /padiem\.kr/i
];

/**
 * Produce a sanitized env for the preview build. Pure: never mutates input.
 * @param {Record<string, string | undefined>} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function sanitizePreviewEnv(baseEnv) {
  const env = { ...baseEnv };
  for (const name of FORBIDDEN_PREVIEW_ENV) {
    delete env[name];
  }
  Object.assign(env, PREVIEW_SAFE_ENV);
  return env;
}

/**
 * Build the registry record consumed by the KILO1 preview gateway (#397).
 * Field names follow the agreed version-registry contract.
 */
export function buildPreviewRegistryRecord({
  sourceSha,
  sourceBranch,
  createdAt,
  bundlePath,
  buildCommand,
  hostnameAllowlist = []
}) {
  if (!sourceSha || !/^[0-9a-f]{7,40}$/.test(sourceSha)) {
    throw new Error(`preview registry requires a full/abbrev git sha, got: ${sourceSha}`);
  }
  return {
    VERSION_NAME: PREVIEW_VERSION_NAME,
    SOURCE_SHA: sourceSha,
    SOURCE_PATH: '04_개발/frontend',
    SOURCE_BRANCH: sourceBranch,
    CREATED_AT: createdAt,
    STATUS: PREVIEW_STATUS,
    MUTABLE: 'NO',
    DO_NOT_MERGE: 'NO (source branch merges additive preview tooling only; the built bundle itself is a gitignored artifact and is never deployed to danjion.pages.dev)',
    SUBPATH: PREVIEW_SUBPATH,
    BUNDLE_PATH: bundlePath,
    BUILD_COMMAND: buildCommand,
    DATA_MODE: 'mock (VITE_DATA_MODE deleted -> localStorage fixture mode)',
    AUTH_MODE: 'dev (VITE_AUTH_MODE deleted -> DevAuthProvider fixture actor)',
    STORAGE_MODE: 'mock (VITE_STORAGE_MODE deleted -> browser-only uploads)',
    API_BASE: 'relative /api only (VITE_API_BASE_URL deleted; no absolute host baked)',
    HOSTNAME_ALLOWLIST: hostnameAllowlist,
    SERVES_PRODUCTION_TRAFFIC: 'NO',
    NOTE: 'Comparison-only snapshot of React V2 for design/runtime review. Not a release artifact.'
  };
}

/**
 * Validate a registry record against the KILO1 gateway contract.
 * @returns {string[]} list of violations (empty when valid)
 */
export function validatePreviewRegistryRecord(record) {
  const violations = [];
  const required = [
    'VERSION_NAME',
    'SOURCE_SHA',
    'SOURCE_PATH',
    'SOURCE_BRANCH',
    'CREATED_AT',
    'STATUS',
    'MUTABLE',
    'DO_NOT_MERGE'
  ];
  for (const key of required) {
    if (typeof record?.[key] !== 'string' || record[key].length === 0) {
      violations.push(`registry.${key} missing or empty`);
    }
  }
  if (record?.STATUS !== PREVIEW_STATUS) {
    violations.push(`registry.STATUS must be ${PREVIEW_STATUS}, got ${record?.STATUS}`);
  }
  if (record?.MUTABLE !== 'NO') {
    violations.push('registry.MUTABLE must be NO for comparison bundles');
  }
  if (record?.SOURCE_SHA && !/^[0-9a-f]{7,40}$/.test(record.SOURCE_SHA)) {
    violations.push(`registry.SOURCE_SHA is not a git sha: ${record.SOURCE_SHA}`);
  }
  if (record?.SUBPATH && record.SUBPATH !== PREVIEW_SUBPATH) {
    violations.push(`registry.SUBPATH must be ${PREVIEW_SUBPATH}`);
  }
  return violations;
}
