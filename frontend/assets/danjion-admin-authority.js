(function (global) {
  'use strict';

  // Issue #460 [admin production]: administrator authority is resolved ONLY from
  // GET /api/v1/admin/authority, which the backend derives exclusively from the
  // padiem_operator_grants of the signed-in actor's own canonical account. The
  // owner's final policy keeps the four designated administrator principals
  // (Owner SUPER, Owner OPERATIONAL, Sibling SUPER, Sibling OPERATIONAL) as
  // SEPARATE canonical users with separate grants: each principal is audited
  // independently and nothing here may assume, link, or silently converge one
  // principal into another. Login methods (Google/Naver/email/Kakao) are never
  // an authority source, and this module can never mint, copy, or widen a
  // grant — it is a read-only GET with strict two-shape validation: anything
  // that is not an exactly-valid SUPER or OPERATIONAL answer is rejected.
  const AUTHORITY_PATH = '/api/v1/admin/authority';
  const SUPER_LABEL = '최고관리자';
  const OPERATOR_LABEL = '일반관리자';

  // General application API traffic (authority included) binds the Worker base
  // from DanjionSession (#419 gate): canonical Pages production auto-binds,
  // controlled previews may pass ?apiBase=, everything else resolves to '' and
  // stays on the demo lane where no admin surface exists at all.
  function resolveApiBase(loc) {
    const session = global.DanjionSession;
    if (!session || typeof session.danjionApiBase !== 'function') return '';
    return String(session.danjionApiBase(loc) || '');
  }

  function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }

  // Strict fail-closed validation at the administrator-entry boundary, mirroring
  // the canonical backend invariants (padiem-authority-v1: wildcard =
  // scopes.includes('*'); level = wildcard ? 'admin' : scopes.length ? 'operator'
  // : 'none'). An HTTP 200 answer opens the admin surface in exactly two shapes:
  //   SUPER      — level 'admin', wildcard strictly true, string[] scopes that
  //                INCLUDE the wildcard scope '*'
  //   OPERATIONAL— level 'operator', wildcard strictly false, non-empty string[]
  //                scopes WITHOUT the wildcard scope '*'
  // Every other payload (null/empty data, unknown or missing level, non-boolean
  // wildcard, malformed scopes, admin-without-wildcard, admin-without-'*',
  // operator with empty scopes, operator-carrying-'*') resolves the rejected
  // 'invalid' state — least privilege is NOT applied as a fallback, because
  // collapsing a malformed grant answer to a usable operator view would open
  // /admin/ on a payload the server never sanctioned.
  function normalizeAuthority(raw) {
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    if (!record) return { state: 'invalid', label: '', scopes: [], wildcard: false };
    const scopes = record.scopes;
    if (record.level === 'admin' && record.wildcard === true && isStringArray(scopes) && scopes.includes('*')) {
      return { state: 'admin', label: SUPER_LABEL, scopes: scopes.slice(), wildcard: true };
    }
    if (record.level === 'operator' && record.wildcard === false && isStringArray(scopes) && scopes.length > 0 && !scopes.includes('*')) {
      return { state: 'operator', label: OPERATOR_LABEL, scopes: scopes.slice(), wildcard: false };
    }
    return { state: 'invalid', label: '', scopes: [], wildcard: false };
  }

  // Maps a DanjionSession.request outcome to an authority state. Anything that
  // is not an exactly-valid 200 grant answer (401/403/5xx/network/malformed)
  // keeps the admin surface hidden — the entry point and the console both fail
  // closed.
  function classifyAuthority(result) {
    if (!result || typeof result !== 'object') return { state: 'error' };
    if (result.ok) return normalizeAuthority(result.data);
    if (result.status === 401) return { state: 'signed-out' };
    if (result.status === 403) return { state: 'denied' };
    return { state: 'error' };
  }

  async function fetchAuthority(fetchImpl, options = {}) {
    const base = options.apiBase === undefined
      ? resolveApiBase(options.location)
      : String(options.apiBase || '');
    if (!base) return { state: 'unbound' };
    const session = global.DanjionSession;
    const result = await session.request(fetchImpl || global.fetch, session.joinUrl(base, AUTHORITY_PATH));
    return classifyAuthority(result);
  }

  function hasAdminSurface(authority) {
    return !!authority && (authority.state === 'admin' || authority.state === 'operator');
  }

  function isSuperAdminAuthority(authority) {
    return !!authority && authority.state === 'admin' && authority.wildcard === true;
  }

  // Resident-verification exemption is granted ONLY by the explicit bounded scope
  // `resident.verification.exempt` carried on the actor's own valid PADIEM
  // authority answer (an exactly-valid SUPER or OPERATIONAL shape). The wildcard
  // '*' alone NEVER exempts: exemption must remain individually grantable and
  // revocable per principal, independently of super-admin reach. Rejected or
  // non-authoritative states (invalid/denied/signed-out/unbound/error) and any
  // malformed scopes payload always resolve false — fail toward the ordinary
  // resident flow, never toward an exemption.
  const RESIDENT_VERIFICATION_EXEMPT_SCOPE = 'resident.verification.exempt';

  function hasResidentVerificationExemption(authority) {
    if (!authority) return false;
    const validAdmin = authority.state === 'admin' && authority.wildcard === true;
    const validOperator = authority.state === 'operator' && authority.wildcard === false;
    return (validAdmin || validOperator)
      && Array.isArray(authority.scopes)
      && authority.scopes.includes(RESIDENT_VERIFICATION_EXEMPT_SCOPE);
  }

  global.DanjionAdminAuthority = Object.freeze({
    AUTHORITY_PATH,
    SUPER_LABEL,
    OPERATOR_LABEL,
    RESIDENT_VERIFICATION_EXEMPT_SCOPE,
    resolveApiBase,
    normalizeAuthority,
    classifyAuthority,
    fetchAuthority,
    hasAdminSurface,
    isSuperAdminAuthority,
    hasResidentVerificationExemption
  });
})(typeof window !== 'undefined' ? window : globalThis);
