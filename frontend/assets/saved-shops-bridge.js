(function (global) {
  'use strict';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STORAGE_KEY = 'danjion:savedShops';

  function apiRoot(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.replace(/\/$/, '');
  }

  function businessIdForKey(key) {
    const text = String(key || '');
    if (!text.startsWith('api-')) return null;
    const id = text.slice(4);
    return UUID.test(id) ? id.toLowerCase() : null;
  }

  function readLocal(storage) {
    try {
      const parsed = JSON.parse(storage && storage.getItem ? (storage.getItem(STORAGE_KEY) || '[]') : '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocal(storage, keys) {
    if (!storage || typeof storage.setItem !== 'function') return;
    storage.setItem(STORAGE_KEY, JSON.stringify([...new Set(keys.map(String))]));
  }

  function createSavedShopsBridge(options) {
    const opts = options || {};
    const fetchImpl = opts.fetchImpl || (global.fetch && global.fetch.bind(global));
    const storage = opts.storage || global.localStorage;
    const base = apiRoot(opts.apiBase);
    const session = global.DanjionSession;
    const canonicalProduction = !!session && typeof session.isCanonicalProduction === 'function'
      && session.isCanonicalProduction(opts.location);
    const serverMode = Boolean(base) || canonicalProduction;
    const endpoint = `${base}/api/v1/me/bookmarks`;
    let mode = serverMode ? 'loading' : 'local';
    let saved = new Set(serverMode ? [] : readLocal(storage));

    function snapshot() {
      return { mode, keys: [...saved] };
    }

    function clearServerState(nextMode) {
      mode = nextMode;
      saved = new Set();
      return snapshot();
    }

    async function load() {
      if (!serverMode) {
        mode = 'local';
        saved = new Set(readLocal(storage));
        return snapshot();
      }
      if (typeof fetchImpl !== 'function') return clearServerState('degraded');
      try {
        const response = await fetchImpl(endpoint, {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' }
        });
        if (response.status === 401) return clearServerState('auth-required');
        if (response.status === 403) return clearServerState('forbidden');
        if (!response.ok) return clearServerState('degraded');
        const payload = await response.json();
        const rows = Array.isArray(payload && payload.data) ? payload.data : [];
        saved = new Set(
          rows
            .map((row) => row && row.id)
            .filter((id) => UUID.test(String(id || '')))
            .map((id) => `api-${String(id).toLowerCase()}`)
        );
        mode = 'server';
        return snapshot();
      } catch (_) {
        return clearServerState('degraded');
      }
    }

    async function toggle(key) {
      const normalizedKey = String(key || '');
      const businessId = businessIdForKey(normalizedKey);
      const currentlySaved = saved.has(normalizedKey);

      if (serverMode) {
        if (mode !== 'server') {
          const error = new Error(`bookmark server authority unavailable: ${mode}`);
          error.mode = mode;
          throw error;
        }
        if (!businessId) {
          const error = new Error('bookmark requires a server business id');
          error.mode = 'client';
          throw error;
        }
        const response = await fetchImpl(`${endpoint}/${businessId}`, {
          method: currentlySaved ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: { accept: 'application/json' }
        });
        if (!response.ok) {
          const error = new Error(`bookmark mutation failed: ${response.status}`);
          error.status = response.status;
          throw error;
        }
        currentlySaved ? saved.delete(normalizedKey) : saved.add(normalizedKey);
        return { mode: 'server', saved: !currentlySaved, key: normalizedKey };
      }

      currentlySaved ? saved.delete(normalizedKey) : saved.add(normalizedKey);
      writeLocal(storage, [...saved]);
      return { mode: 'local', saved: !currentlySaved, key: normalizedKey };
    }

    function isSaved(key) {
      return saved.has(String(key || ''));
    }

    return { load, toggle, isSaved, snapshot, businessIdForKey };
  }

  global.DanJionSavedShopsBridge = Object.freeze({
    create: createSavedShopsBridge,
    businessIdForKey,
    STORAGE_KEY
  });
})(typeof window !== 'undefined' ? window : globalThis);
