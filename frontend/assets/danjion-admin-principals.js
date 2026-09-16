(function (global) {
  'use strict';

  const COLLECTION_PATH = '/api/v1/admin/principals';

  function classify(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) return { state: 'ready', data: result.data, status: result.status, code };
    if (result && result.status === 401) return { state: 'signed-out', status: 401, code };
    if (result && result.status === 403) return { state: 'forbidden', status: 403, code };
    if (result && result.status === 404) return { state: 'not-found', status: 404, code };
    if (result && result.status === 409) return { state: 'conflict', status: 409, code };
    if (!result || result.reason === 'network-error' || result.status === 0) return { state: 'network-error', status: 0, code };
    return { state: 'error', status: Number(result.status || 0), code };
  }

  function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    return email && email.includes('@') ? email : '';
  }

  function roleValue(value) {
    const role = String(value || '').trim();
    return role === 'admin' || role === 'operator' ? role : '';
  }

  async function list(fetchImpl, apiBase) {
    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), COLLECTION_PATH)
    );
    const outcome = classify(result);
    if (outcome.state === 'ready') {
      return {
        ...outcome,
        rows: Array.isArray(outcome.data) ? outcome.data : []
      };
    }
    return { ...outcome, rows: [] };
  }

  async function create(fetchImpl, apiBase, input) {
    const email = normalizeEmail(input && input.email);
    const role = roleValue(input && input.role);
    if (!email || !role) return { state: 'invalid-request', status: 0, code: 'INVALID_ADMIN_PRINCIPAL_REQUEST' };

    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), COLLECTION_PATH),
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          role,
          reason: String(input && input.reason || '').trim() || null
        })
      }
    );
    return classify(result);
  }

  async function update(fetchImpl, apiBase, principalId, input) {
    const id = String(principalId || '').trim();
    const role = roleValue(input && input.role);
    const status = String(input && input.status || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !role || !['active', 'revoked'].includes(status)) {
      return { state: 'invalid-request', status: 0, code: 'INVALID_ADMIN_PRINCIPAL_REQUEST' };
    }

    const session = global.DanjionSession;
    const result = await session.request(
      fetchImpl,
      session.joinUrl(String(apiBase || ''), COLLECTION_PATH + '/' + encodeURIComponent(id)),
      {
        method: 'PATCH',
        body: JSON.stringify({
          role,
          status,
          reason: String(input && input.reason || '').trim() || null
        })
      }
    );
    return classify(result);
  }

  global.DanjionAdminPrincipals = Object.freeze({
    list,
    create,
    update
  });
})(typeof window !== 'undefined' ? window : globalThis);
