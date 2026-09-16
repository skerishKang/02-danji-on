export type AdminPrincipalRole = 'admin' | 'operator';

export const OPERATIONAL_ADMIN_SCOPES = Object.freeze([
  'benefit.manage',
  'business.review',
  'community.moderate',
  'inquiry.respond',
  'official-content.manage',
  'resident.verification.exempt',
  'resident_news.review',
  'safety.report.review'
] as const);

export const SUPER_ADMIN_RUNTIME_SCOPES = Object.freeze([
  '*',
  ...OPERATIONAL_ADMIN_SCOPES
] as const);

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function sameScopes(actual: readonly string[], expected: readonly string[]): boolean {
  const a = sorted(Array.from(new Set(actual.map((scope) => String(scope).trim()))));
  const e = sorted(expected);
  return a.length === e.length && a.every((scope, index) => scope === e[index]);
}

/**
 * Allowlist storage policy.
 *
 * Migration 049 deliberately constrains SUPER principal rows to ['*'].
 * OPERATIONAL rows store the full bounded day-to-day bundle.
 */
export function principalScopesForRole(role: AdminPrincipalRole): string[] {
  return role === 'admin' ? ['*'] : [...OPERATIONAL_ADMIN_SCOPES];
}

/**
 * Runtime authorization policy.
 *
 * SUPER keeps wildcard plus the same bounded scopes so explicit-scope features
 * such as resident.verification.exempt continue to work. This preserves the
 * existing Production 9/8 grant shape while privileged platform.* authority
 * still depends on wildcard.
 */
export function runtimeScopesForRole(role: AdminPrincipalRole): string[] {
  return role === 'admin'
    ? [...SUPER_ADMIN_RUNTIME_SCOPES]
    : [...OPERATIONAL_ADMIN_SCOPES];
}

export function isCanonicalPrincipalScopes(
  role: AdminPrincipalRole,
  scopes: readonly string[]
): boolean {
  return sameScopes(scopes, principalScopesForRole(role));
}
