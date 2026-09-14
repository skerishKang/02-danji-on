(function (global) {
  'use strict';

  // Issue #460 [admin production]: administrator authority is resolved ONLY from
  // GET /api/v1/admin/authority, which the backend derives exclusively from the
  // canonical-user rows in padiem_operator_grants. Google/Naver/email/Kakao are
  // login methods, not separate administrator identities: whichever linked
  // method a canonical user signs in with, the same server-side grant resolves
  // the same authority. This module NEVER infers a role from email, provider
  // names, browser storage, or query parameters, and it can never mint, copy,
  // or widen a grant — it is a read-only GET with the fail-closed normalization
  // promoted from the #412 admin console discipline.
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

  // Fail-closed normalization: a 최고관리자 view is valid ONLY when the admin
  // level and the wildcard flag agree. Every malformed or inconsistent payload
  // collapses to the least-privileged operator view with wildcard forced false.
  function normalizeAuthority(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    const superAdmin = record.level === 'admin' && record.wildcard === true;
    const scopes = Array.isArray(record.scopes)
      ? record.scopes.filter((scope) => typeof scope === 'string')
      : [];
    return {
      state: superAdmin ? 'admin' : 'operator',
      label: superAdmin ? SUPER_LABEL : OPERATOR_LABEL,
      scopes,
      wildcard: superAdmin
    };
  }

  // Maps a DanjionSession.request outcome to an authority state. Anything that
  // is not an explicit 200 grant answer (401/403/5xx/network/malformed) keeps
  // the admin surface hidden — the entry point and the console both fail closed.
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

  global.DanjionAdminAuthority = Object.freeze({
    AUTHORITY_PATH,
    SUPER_LABEL,
    OPERATOR_LABEL,
    resolveApiBase,
    normalizeAuthority,
    classifyAuthority,
    fetchAuthority,
    hasAdminSurface,
    isSuperAdminAuthority
  });
})(typeof window !== 'undefined' ? window : globalThis);
