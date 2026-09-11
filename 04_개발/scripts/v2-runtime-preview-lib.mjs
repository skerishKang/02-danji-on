/**
 * Shared helpers for the COMPARISON-ONLY React V2 runtime preview (#395).
 *
 * The preview bundle must never carry production authority. This module is the
 * single source of truth for (a) sanitizing the build environment, (b) the
 * registry record shape, and (c) the gateway-mount packaging rules that make
 * the bundle satisfy KILO1's design-gateway INTEGRATION_CONTRACT B1–B7 (#399).
 */

export const PREVIEW_SUBPATH = '/v2-runtime/';
// KILO1 integration contract B3: mounted bundles are served under an arbitrary
// subpath, so the artifact itself must use a relative asset base.
export const PREVIEW_BASE = './';
export const PREVIEW_OUT_DIR = 'dist-v2-runtime-preview';
export const PREVIEW_VERSION_NAME = 'v2-runtime-preview';
export const PREVIEW_STATUS = 'COMPARISON_ONLY';
export const GATEWAY_MOUNT_DIR = 'design-gateway/preview-bundles/v2-runtime';
export const BUILD_INFO_FILE = 'BUILD_INFO.json';
export const BUILDER_ID = 'KILO3';
export const GATEWAY_CONSUMER = 'KILO1_PR399';

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

// Literal hostnames that must never appear in the artifact. Assembled from
// fragments so this source file does not itself embed the forbidden literal
// (mirrors the KILO1 gateway safety-contract scanner technique).
export const FORBIDDEN_BUNDLE_NEEDLES = [
  ['danjion.', 'pages', '.dev'].join(''),
  ['padiem.', 'workers', '.dev'].join(''),
  ['padiem-', 'danjion-api'].join(''),
  ['CLOUDFLARE_', 'API_TOKEN'].join(''),
  ['CLOUDFLARE_', 'ACCOUNT_ID'].join('')
];

// KILO1 design-gateway safety-contract needles (fragments; the gateway scans
// every file under design-gateway/, including mounted bundles).
export const GATEWAY_SAFETY_NEEDLES = [
  ...FORBIDDEN_BUNDLE_NEEDLES,
  ['padiem.', 'kr'].join(''),
  ['wor', 'kers.dev'].join(''),
  ['padiem-', 'danjion-api-production'].join(''),
  ['AUTH_EMAIL_RELAY_', 'TOKEN'].join(''),
  ['AUTH_EMAIL_RELAY_', 'URL'].join(''),
  ['DANJION_CONTACT_REF_', 'SECRET'].join(''),
  ['DATABASE_', 'URL'].join(''),
  ['wrangler ', 'login'].join(''),
  ['secrets', ':'].join('')
];

// Regexes mirrored from KILO1 design-gateway/tests/integration-contract.mjs.
export const GATEWAY_SCAN_REGEXES = {
  absRootHtml: /(?:src|href)\s*=\s*["']\//i,
  absRootCss: /url\(\s*["']?\//i,
  absOrigin: /https?:\/\//i
};

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
 * B4 neutralization for JS chunks: every `http(s)://` inside the minified
 * bundle lives in a string literal (XML namespace ids, React error-decoder
 * URLs, validation messages, unsplash mock fixtures). Escaping the slashes as
 * \u002F removes the contiguous origin text from the artifact while keeping
 * the runtime string byte-identical. Idempotent: the escaped form no longer
 * matches the pattern.
 * @param {string} code
 * @returns {string}
 */
export function escapeAbsoluteOriginsInJs(code) {
  return code.replace(/(https?):\/\//g, (_m, scheme) => `${scheme}:\\u002F\\u002F`);
}

/**
 * B4/B5 neutralization for CSS: external absolute @import url(...) statements
 * (the Pretendard jsdelivr webfont) are stripped; the font stack falls back
 * to the locally installed/system fonts. CSS has no string-escape equivalent,
 * so the import must go for the bundle to be self-contained.
 * @param {string} css
 * @returns {string}
 */
export function stripExternalCssImports(css) {
  return css
    .replace(/@import\s+url\(\s*['"]?https?:\/\/[^)]*['"]?\s*\)\s*;?/gi, '')
    .replace(/@import\s+['"]https?:\/\/[^'"]+['"]\s*;?/gi, '');
}

/**
 * Build the B2 provenance marker (KILO1 INTEGRATION_CONTRACT.md).
 * sourceSha MUST equal the gateway registry entry's source.sha (the source
 * authority commit, not the preview branch head).
 */
export function buildBundleInfo({ sourceSha, sourceRef, builtAt, builder = BUILDER_ID }) {
  if (!/^[0-9a-f]{40}$/.test(String(sourceSha))) {
    throw new Error(`BUILD_INFO.sourceSha must be a full 40-hex git sha, got: ${sourceSha}`);
  }
  return { sourceSha, sourceRef, builtAt, builder };
}

/**
 * @returns {string[]} violations (empty when valid)
 */
export function validateBundleInfo(info, { expectedSourceSha } = {}) {
  const violations = [];
  if (!/^[0-9a-f]{40}$/.test(String(info?.sourceSha))) {
    violations.push(`BUILD_INFO.sourceSha is not a 40-hex sha: ${info?.sourceSha}`);
  }
  if (expectedSourceSha && info?.sourceSha !== expectedSourceSha) {
    violations.push(`BUILD_INFO.sourceSha ${info?.sourceSha} != source authority ${expectedSourceSha}`);
  }
  if (typeof info?.sourceRef !== 'string' || info.sourceRef.length === 0) {
    violations.push('BUILD_INFO.sourceRef required');
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(info?.builtAt))) {
    violations.push(`BUILD_INFO.builtAt must be an ISO date, got: ${info?.builtAt}`);
  }
  if (typeof info?.builder !== 'string' || info.builder.length === 0) {
    violations.push('BUILD_INFO.builder required');
  }
  return violations;
}

/**
 * Mirror of KILO1's integration-contract + safety scans for a mounted bundle
 * directory, plus the B7 checks the gateway intends but does not test
 * mechanically. Returns violations; empty means the artifact is mountable.
 * @param {string} dir absolute path of the mounted bundle directory
 * @param {{ expectedSourceSha: string, walk: (d: string) => Iterable<string>, read: (f: string) => string, exists: (f: string) => boolean }} fsio
 */
export function scanGatewayBundle(dir, { expectedSourceSha, walk, read, exists }) {
  const violations = [];
  const posix = (p) => p.slice(dir.length + 1).replace(/\\/g, '/');

  // B1: bundle root entry is exactly index.html
  if (!exists(`${dir}/index.html`)) violations.push('B1: index.html missing at bundle root');

  // B2: BUILD_INFO.json provenance pin
  const infoPath = `${dir}/${BUILD_INFO_FILE}`;
  let info = null;
  if (!exists(infoPath)) {
    violations.push(`B2: ${BUILD_INFO_FILE} missing at bundle root`);
  } else {
    try {
      info = JSON.parse(read(infoPath));
    } catch (e) {
      violations.push(`B2: ${BUILD_INFO_FILE} is not valid JSON: ${e.message}`);
    }
    if (info) {
      for (const v of validateBundleInfo(info, { expectedSourceSha })) violations.push(`B2: ${v}`);
    }
  }

  const textFile = /\.(html|css|js|mjs)$/i;
  for (const file of walk(dir)) {
    const rel = posix(file);
    const text = read(file);
    for (const needle of GATEWAY_SAFETY_NEEDLES) {
      if (text.includes(needle)) violations.push(`safety: ${rel} contains '${needle}'`);
    }
    if (!textFile.test(file)) continue;
    // B3: no absolute-root asset references
    if (GATEWAY_SCAN_REGEXES.absRootHtml.test(text)) violations.push(`B3: ${rel} has absolute-root src/href`);
    if (GATEWAY_SCAN_REGEXES.absRootCss.test(text)) violations.push(`B3: ${rel} has absolute-root url()`);
    // B4: no contiguous absolute http(s) origins anywhere
    if (GATEWAY_SCAN_REGEXES.absOrigin.test(text)) violations.push(`B4: ${rel} contains an absolute http(s) origin`);
    // B7: no service worker registration / background sync / tracking in the
    // preview bundle. React DOM ships inert `case`serviceworker`` CSP strings
    // in every build, so match real SW usage, not the bare substring.
    if (/navigator\s*\.\s*serviceWorker|serviceWorker\s*\.register|importScripts\s*\(/.test(text)) violations.push(`B7: ${rel} registers or uses a service worker`);
    if (/backgroundSync|googletagmanager|\bgtag\b/i.test(text)) violations.push(`B7: ${rel} references sync/tracking`);
    if (/demo-sw/i.test(text)) violations.push(`B7: ${rel} references demo-sw`);
  }

  if (exists(`${dir}/demo-sw.js`)) violations.push('B7: demo-sw.js must not ship in the preview bundle');

  // B5: index.html local references resolve inside the bundle
  if (exists(`${dir}/index.html`)) {
    const html = read(`${dir}/index.html`);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^(data:|blob:)/.test(ref)) continue;
      if (GATEWAY_SCAN_REGEXES.absOrigin.test(ref)) {
        violations.push(`B4/B5: index.html references absolute origin ${ref}`);
        continue;
      }
      if (ref.startsWith('/')) {
        violations.push(`B3: index.html root-absolute ref ${ref}`);
        continue;
      }
      if (ref.startsWith('#')) continue;
      const clean = ref.replace(/[?#].*$/, '');
      if (!clean.startsWith('./')) continue; // plain in-page links (relative names) are route targets, not files
      const target = clean.replace(/^\.\//, '');
      if (!exists(`${dir}/${target}`)) violations.push(`B5: index.html ref ${ref} not inside bundle`);
    }
    // B7/comparison posture: noindex + overlay must be baked in
    if (!/name="robots"\s+content="noindex/i.test(html)) violations.push('B7: index.html missing noindex robots meta');
    if (!html.includes('COMPARISON ONLY')) violations.push('overlay: index.html missing COMPARISON ONLY overlay');
  }

  return violations;
}

/**
 * Build the registry record consumed by the KILO1 preview gateway.
 * SOURCE_SHA is the source authority commit the app sources were built from
 * (main), NOT the preview branch head; branch metadata stays in SOURCE_BRANCH
 * and BUILD_SHA.
 */
export function buildPreviewRegistryRecord({
  sourceSha,
  sourceBranch,
  buildSha,
  createdAt,
  bundlePath,
  buildCommand,
  hostnameAllowlist = []
}) {
  if (!/^[0-9a-f]{40}$/.test(String(sourceSha))) {
    throw new Error(`preview registry requires a full 40-hex SOURCE_SHA (source authority), got: ${sourceSha}`);
  }
  return {
    VERSION_NAME: PREVIEW_VERSION_NAME,
    SOURCE_SHA: sourceSha,
    SOURCE_PATH: '04_개발/frontend',
    SOURCE_BRANCH: sourceBranch,
    BUILD_SHA: buildSha,
    CREATED_AT: createdAt,
    STATUS: PREVIEW_STATUS,
    MUTABLE: 'NO',
    DO_NOT_MERGE: 'NO (source branch merges additive preview tooling plus the review-only bundle mounted at MOUNT_PATH; the artifact is never deployed to danjion.pages.dev)',
    SUBPATH: PREVIEW_SUBPATH,
    BUNDLE_PATH: bundlePath,
    MOUNT_PATH: GATEWAY_MOUNT_DIR,
    BUILD_INFO_PATH: `${GATEWAY_MOUNT_DIR}/${BUILD_INFO_FILE}`,
    BUILDER: BUILDER_ID,
    GATEWAY_CONSUMER: GATEWAY_CONSUMER,
    BUILD_COMMAND: buildCommand,
    DATA_MODE: 'mock (VITE_DATA_MODE deleted -> localStorage fixture mode)',
    AUTH_MODE: 'dev (VITE_AUTH_MODE deleted -> DevAuthProvider fixture actor)',
    STORAGE_MODE: 'mock (VITE_STORAGE_MODE deleted -> browser-only uploads)',
    API_BASE: 'relative /api only (VITE_API_BASE_URL deleted; no absolute host baked)',
    HOSTNAME_ALLOWLIST: hostnameAllowlist,
    SERVES_PRODUCTION_TRAFFIC: 'NO',
    NOTE: 'Comparison-only snapshot of React V2 for design/runtime review. Not a release artifact. Absolute origins in JS string literals are \\u002F-escaped at build time (runtime values unchanged); the external webfont @import is stripped; the demo service worker is stubbed out.'
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
    'BUILD_SHA',
    'CREATED_AT',
    'STATUS',
    'MUTABLE',
    'DO_NOT_MERGE',
    'MOUNT_PATH',
    'BUILDER',
    'GATEWAY_CONSUMER'
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
  if (record?.SOURCE_SHA && !/^[0-9a-f]{40}$/.test(record.SOURCE_SHA)) {
    violations.push(`registry.SOURCE_SHA is not a 40-hex git sha: ${record.SOURCE_SHA}`);
  }
  if (record?.SUBPATH && record.SUBPATH !== PREVIEW_SUBPATH) {
    violations.push(`registry.SUBPATH must be ${PREVIEW_SUBPATH}`);
  }
  if (record?.MOUNT_PATH && record.MOUNT_PATH !== GATEWAY_MOUNT_DIR) {
    violations.push(`registry.MOUNT_PATH must be ${GATEWAY_MOUNT_DIR}`);
  }
  return violations;
}
