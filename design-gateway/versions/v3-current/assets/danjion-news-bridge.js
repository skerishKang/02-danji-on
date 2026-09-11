export const DANJION_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

export const NEWS_CHANNELS = ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'];

function joinUrl(base, path) {
  const root = String(base || '').replace(/\/+$/, '');
  return `${root}${path}`;
}

async function parseJson(response) {
  try { return await response.json(); } catch { return null; }
}

function failure(status, payload) {
  return { ok: false, reason: status === 401 || status === 403 ? 'auth-required' : 'server-error', status, error: payload?.error || null };
}

async function pubFetch(fetchImpl, url) {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'accept': 'application/json' }
    });
    const payload = await parseJson(response);
    if (!response.ok) return failure(response.status, payload);
    return { ok: true, status: response.status, data: payload?.data ?? null, requestId: payload?.requestId ?? null };
  } catch (error) {
    return { ok: false, reason: 'network-error', status: 0, error };
  }
}

function normalizePost(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    sourceName: row.source_name ?? row.sourceName ?? null,
    category: row.category ?? null,
    channel: row.channel ?? null,
    title: String(row.title || ''),
    body: row.body ?? '',
    attachmentObjectKey: row.attachment_object_key ?? row.attachmentObjectKey ?? null,
    publishedAt: row.published_at ?? row.publishedAt ?? null
  };
}

export function createNewsBridge({ apiBase = '', fetchImpl = globalThis.fetch, complexSlug = DANJION_COMPLEX_SLUG } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const slug = encodeURIComponent(complexSlug);
  return {
    async listPosts(channel, { limit = 50 } = {}) {
      const params = new URLSearchParams();
      if (channel && channel !== 'all') params.set('channel', channel);
      params.set('limit', String(Math.min(Math.max(1, limit), 50)));
      const result = await pubFetch(fetchImpl, joinUrl(apiBase, `/api/v1/complexes/${slug}/posts?${params.toString()}`));
      if (!result.ok) return result;
      const rows = Array.isArray(result.data) ? result.data : [];
      return { ...result, data: rows.map(normalizePost).filter(Boolean) };
    },
    async getPost(postId) {
      const id = String(postId || '');
      if (!id) return { ok: false, reason: 'validation-error', status: 0, error: null };
      const result = await pubFetch(fetchImpl, joinUrl(apiBase, `/api/v1/complexes/${slug}/posts/${id}`));
      if (!result.ok) return result;
      return { ...result, data: normalizePost(result.data) };
    },
    async listChannels() {
      const result = await pubFetch(fetchImpl, joinUrl(apiBase, `/api/v1/complexes/${slug}/posts?limit=1`));
      return result;
    }
  };
}
