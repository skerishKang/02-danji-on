(() => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ACTIVITY_TYPES = new Set(['all', 'posts', 'comments', 'reactions', 'reviews']);
  const MAX_LIMIT = 50;

  function normalizeBase(value) {
    const text = String(value || '').trim().replace(/\/$/, '');
    return text || location.origin;
  }

  async function requestJson(fetchImpl, url, init) {
    let response;
    try {
      response = await fetchImpl(url, { credentials: 'include', ...init });
    } catch (error) {
      return { ok: false, status: 0, error: 'NETWORK_ERROR', cause: error };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: payload?.error?.code || `HTTP_${response.status}`, payload };
    }
    return { ok: true, status: response.status, data: payload?.data ?? null, payload };
  }

  function authMode(result) {
    return [401, 403].includes(result.status) ? 'auth-required' : 'error';
  }

  function activityType(value) {
    const text = String(value || 'all').trim();
    return ACTIVITY_TYPES.has(text) ? text : 'all';
  }

  function activityLimit(value) {
    const parsed = Number(value == null ? 20 : value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : 20;
  }

  function serverConfig() {
    let apiBase = '';
    try {
      apiBase = String(new URLSearchParams(location.search).get('apiBase') || '').trim().replace(/\/+$/, '');
    } catch (_) {
      apiBase = '';
    }
    return { enabled: Boolean(apiBase), apiBase, complexSlug: 'banglim-myeongji-roadhill' };
  }

  function createResidentBridge(options = {}) {
    const fetchImpl = options.fetchImpl || fetch.bind(globalThis);
    const apiBase = normalizeBase(options.apiBase);
    const complexSlug = String(options.complexSlug || 'banglim-myeongji-roadhill');
    const query = '?complexSlug=' + encodeURIComponent(complexSlug);

    async function profile() {
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/profile${query}`, { method: 'GET' });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, profile: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function publicProfile(userId) {
      const text = String(userId || '').trim().toLowerCase();
      if (!UUID.test(text)) return { ok: false, mode: 'client', error: 'PROFILE_USER_ID_REQUIRED' };
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/profiles/${text}${query}`, { method: 'GET' });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, profile: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function updateProfile(patch) {
      const input = patch && typeof patch === 'object' ? patch : {};
      const payload = {};
      if (Object.prototype.hasOwnProperty.call(input, 'nickname')) payload.nickname = input.nickname;
      if (Object.prototype.hasOwnProperty.call(input, 'avatarUrl')) payload.avatarUrl = input.avatarUrl;
      if (Object.prototype.hasOwnProperty.call(input, 'publicBio')) payload.publicBio = input.publicBio;
      if (!Object.keys(payload).length) return { ok: false, mode: 'client', error: 'PROFILE_PATCH_EMPTY' };
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/profile${query}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, profile: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function settings() {
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/settings${query}`, { method: 'GET' });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, settings: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function updateSetting(publicProfileEnabled) {
      if (typeof publicProfileEnabled !== 'boolean') {
        return { ok: false, mode: 'client', error: 'SETTING_VALUE_REQUIRED' };
      }
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/settings${query}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publicProfileEnabled })
      });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, settings: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function activity(type, limit, cursor) {
      const params = new URLSearchParams({ complexSlug, type: activityType(type), limit: String(activityLimit(limit)) });
      if (cursor) params.set('cursor', String(cursor));
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/activity?${params.toString()}`, { method: 'GET' });
      const items = Array.isArray(result.data?.items) ? result.data.items : [];
      if (!result.ok) {
        return { ok: false, mode: authMode(result), status: result.status, error: result.error, items, nextCursor: null };
      }
      return { ok: true, mode: 'server', status: result.status, items, nextCursor: result.data?.nextCursor ?? null };
    }

    async function summary() {
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/summary${query}`, { method: 'GET' });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, summary: result.data }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    async function consents() {
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/consents`, { method: 'GET' });
      const rows = Array.isArray(result.data?.consents) ? result.data.consents : [];
      if (!result.ok) return { ok: false, mode: authMode(result), status: result.status, error: result.error, consents: [] };
      return { ok: true, mode: 'server', status: result.status, consents: rows };
    }

    async function setConsent(consentType, policyVersion, status) {
      const type = String(consentType || '').trim();
      const version = String(policyVersion || '').trim();
      const value = String(status || '').trim();
      if (!type || !version || !value) return { ok: false, mode: 'client', error: 'CONSENT_FIELDS_REQUIRED' };
      const result = await requestJson(fetchImpl, `${apiBase}/api/v1/me/consents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consentType: type, policyVersion: version, status: value })
      });
      return result.ok
        ? { ok: true, mode: 'server', status: result.status, consent: result.data?.consent ?? null }
        : { ok: false, mode: authMode(result), status: result.status, error: result.error };
    }

    return { profile, publicProfile, updateProfile, settings, updateSetting, activity, summary, consents, setConsent };
  }

  globalThis.DanjionResidentBridge = { createResidentBridge, serverConfig };
})();
