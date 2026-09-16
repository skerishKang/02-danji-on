(function (global) {
  'use strict';

  const AUDIT_PATH = '/api/v1/admin/audit-events';
  const DECISIONS = Object.freeze(['allowed', 'denied', 'recorded']);

  function classify(result) {
    const code = result && result.error && result.error.code ? String(result.error.code) : '';
    if (result && result.ok) {
      return {
        state: 'ready',
        rows: Array.isArray(result.data) ? result.data : [],
        status: result.status,
        code
      };
    }
    if (result && result.status === 401) return { state: 'signed-out', rows: [], status: 401, code };
    if (result && result.status === 403) return { state: 'forbidden', rows: [], status: 403, code };
    if (result && result.status === 400) return { state: 'invalid-request', rows: [], status: 400, code };
    if (!result || result.reason === 'network-error' || result.status === 0) {
      return { state: 'network-error', rows: [], status: 0, code };
    }
    return { state: 'error', rows: [], status: Number(result.status || 0), code };
  }

  function normalizedOptions(options) {
    const input = options && typeof options === 'object' ? options : {};
    const decision = String(input.decision || '').trim();
    const before = String(input.before || '').trim();
    const rawLimit = Number(input.limit || 100);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 100;
    if (decision && !DECISIONS.includes(decision)) return null;
    if (before && Number.isNaN(Date.parse(before))) return null;
    return { decision, before, limit };
  }

  async function list(fetchImpl, apiBase, options) {
    const normalized = normalizedOptions(options);
    if (!normalized) return { state: 'invalid-request', rows: [], status: 0, code: 'INVALID_AUDIT_QUERY' };

    const session = global.DanjionSession;
    const url = new URL(session.joinUrl(String(apiBase || ''), AUDIT_PATH));
    url.searchParams.set('limit', String(normalized.limit));
    if (normalized.decision) url.searchParams.set('decision', normalized.decision);
    if (normalized.before) url.searchParams.set('before', new Date(normalized.before).toISOString());

    const result = await session.request(fetchImpl, url.toString());
    return classify(result);
  }

  global.DanjionAdminGlobalAudit = Object.freeze({
    DECISIONS,
    list
  });
})(typeof window !== 'undefined' ? window : globalThis);
