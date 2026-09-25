export const LEGACY_GRANDFATHERED_MOUNTED_BUNDLES = Object.freeze([
  'v2-runtime',
  'v2-runtime-post984'
]);

const ABS_ROOT_HTML = /(?:src|href)\s*=\s*["']\//i;
const ABS_ROOT_CSS = /url\(\s*["']?\//i;
const ABS_ROOT_JS = /(?:href|src)\s*[:=]\s*(?:["'`])?\/(?!\/)/i;

export function isLegacyGrandfatheredBundle(versionId) {
  return LEGACY_GRANDFATHERED_MOUNTED_BUNDLES.includes(versionId);
}

export function absoluteRootViolations(text, { legacy = false } = {}) {
  const violations = [];
  if (ABS_ROOT_HTML.test(text)) violations.push('absolute-root HTML src/href');
  if (ABS_ROOT_CSS.test(text)) violations.push('absolute-root CSS url()');
  if (!legacy && ABS_ROOT_JS.test(text)) violations.push('absolute-root JavaScript href/src object property');
  return violations;
}

export function scanAbsoluteRootText(text, options) {
  return absoluteRootViolations(text, options);
}
