// #984 [Auth/UI]: dependency-free runtime social-provider capability contract.
//
// This module is intentionally plain JavaScript with no imports so it can be
// executed directly by the Node contract test as well as bundled by Vite. The
// frontend must never re-derive provider readiness from its own environment
// (no `if production then google`, no `VITE_ENABLE_GOOGLE`, no hostname
// switches): the backend runtime capability response is the only source of
// truth, and this module only validates/normalizes it.

/** Product UI supports exactly Kakao and Google. Naver stays hidden (#586). */
export const UI_SOCIAL_PROVIDER_ORDER = Object.freeze(['kakao', 'google']);

/** Canonical public runtime-capability route on the auth Worker. */
export const AUTH_CAPABILITY_PATH = '/api/auth/capabilities';

/**
 * Fail-closed normalizer for `data.socialProviders`. Unknown names, wrong
 * types, duplicates, and Naver are all dropped; only known UI-supported
 * providers survive, in product order. Unavailable input yields an empty list.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeUiSocialProviders(value) {
  if (!Array.isArray(value)) return [];
  const available = new Set();
  for (const entry of value) {
    if (entry === 'kakao' || entry === 'google') available.add(entry);
  }
  return UI_SOCIAL_PROVIDER_ORDER.filter((provider) => available.has(provider));
}

/**
 * Extract a safe provider list from an arbitrary parsed capability body.
 * Any malformed shape fails closed to an empty list.
 *
 * @param {unknown} body
 * @returns {string[]}
 */
export function socialProvidersFromCapabilityBody(body) {
  if (!body || typeof body !== 'object') return [];
  const data = /** @type {{ data?: unknown }} */ (body).data;
  if (!data || typeof data !== 'object') return [];
  return normalizeUiSocialProviders(/** @type {{ socialProviders?: unknown }} */ (data).socialProviders);
}
