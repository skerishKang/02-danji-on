(function (global) {
  'use strict';

  // #592 / #396 — administrator onboarding bridge.
  //
  // This module does NOT decide administrator authority. It only asks the
  // server to consume a pre-registered administrator identity and materialize
  // its approved scopes into the canonical padiem_operator_grants ledger.
  // No email/provider/role/scope is ever sent by the browser.
  const BOOTSTRAP_PATH = '/api/v1/admin/bootstrap';

  function resolveApiBase(loc) {
    const authority = global.DanjionAdminAuthority;
    if (!authority || typeof authority.resolveApiBase !== 'function') return '';
    return String(authority.resolveApiBase(loc) || '');
  }

  async function bootstrapAuthority(fetchImpl, options = {}) {
    const base = options.apiBase === undefined
      ? resolveApiBase(options.location)
      : String(options.apiBase || '');
    if (!base) return { state: 'unbound' };

    const session = global.DanjionSession;
    const authority = global.DanjionAdminAuthority;
    if (!session || typeof session.request !== 'function' || !authority) return { state: 'error' };

    const result = await session.request(
      fetchImpl || global.fetch,
      session.joinUrl(base, BOOTSTRAP_PATH),
      { method: 'POST' }
    );

    if (result && result.ok) return authority.normalizeAuthority(result.data);
    if (result && result.status === 401) return { state: 'signed-out' };
    if (result && result.status === 403) return { state: 'not-registered' };
    if (result && result.status === 503) return { state: 'unavailable' };
    return { state: 'error' };
  }

  global.DanjionAdminBootstrap = Object.freeze({
    BOOTSTRAP_PATH,
    resolveApiBase,
    bootstrapAuthority
  });
})(typeof window !== 'undefined' ? window : globalThis);
