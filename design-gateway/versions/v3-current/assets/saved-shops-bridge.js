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
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function writeLocal(storage, keys) {
    storage.setItem(STORAGE_KEY, JSON.stringify([...new Set(keys.map(String))]));
  }

  function createSavedShopsBridge(options) {
    const fetchImpl = options && options.fetchImpl ? options.fetchImpl : global.fetch.bind(global);
    const storage = options && options.storage ? options.storage : global.localStorage;
    const base = apiRoot(options && options.apiBase);
    const endpoint = `${base}/api/v1/me/bookmarks`;
    let mode = 'unknown';
    let saved = new Set(readLocal(storage));

    function snapshot() {
      return { mode, keys: [...saved] };
    }

    async function load() {
      try {
        const response = await fetchImpl(endpoint, { method: 'GET', credentials: 'include', headers: { accept: 'application/json' } });
        if (response.status === 401 || response.status === 403) {
          mode = 'local';
          saved = new Set(readLocal(storage));
          return snapshot();
        }
        if (!response.ok) {
          mode = 'degraded';
          saved = new Set(readLocal(storage));
          return snapshot();
        }
        const payload = await response.json();
        const rows = Array.isArray(payload && payload.data) ? payload.data : [];
        saved = new Set(rows.map((row) => row && row.id).filter((id) => UUID.test(String(id || ''))).map((id) => `api-${String(id).toLowerCase()}`));
        mode = 'server';
        return snapshot();
      } catch (_) {
        mode = 'degraded';
        saved = new Set(readLocal(storage));
        return snapshot();
      }
    }

    async function toggle(key) {
      const normalizedKey = String(key || '');
      const businessId = businessIdForKey(normalizedKey);
      const currentlySaved = saved.has(normalizedKey);

      if (mode === 'server' && businessId) {
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
        return { mode, saved: !currentlySaved, key: normalizedKey };
      }

      currentlySaved ? saved.delete(normalizedKey) : saved.add(normalizedKey);
      writeLocal(storage, [...saved]);
      return { mode: mode === 'unknown' ? 'local' : mode, saved: !currentlySaved, key: normalizedKey };
    }

    function isSaved(key) {
      return saved.has(String(key || ''));
    }

    return { load, toggle, isSaved, snapshot, businessIdForKey };
  }

  global.DanJionSavedShopsBridge = Object.freeze({ create: createSavedShopsBridge, businessIdForKey, STORAGE_KEY });
})(typeof window !== 'undefined' ? window : globalThis);
