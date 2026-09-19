export const DANJION_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

export const NEWS_CHANNELS = ['danjion_notice', 'apartment_news', 'management_office', 'chair_greeting'];

// #768: server-authoritative presentation mode for apartment-news posts. The
// list page must never infer "popup vs article" from length in the browser.
export const NEWS_DISPLAY_MODES = ['highlight', 'article'];

// Mirrors the canonical keys in 04_개발/backend/src/complex-news-channel.ts
// (CHANNEL_AUTHORITY). The labels are presentation-only; the key is the contract.
export const NEWS_AUTHORITY_LABELS = {
  danjion_operator: '단지온 운영자',
  resident_council: '입주자대표회의',
  management_office: '관리사무소',
  resident_council_representative: '입주자대표회장'
};

export function newsAuthorityLabel(key) {
  const raw = key == null ? '' : String(key);
  // Never fabricate an authority: an unknown or absent key renders no label,
  // it must never be attributed to the 입주자대표회의 by default.
  return NEWS_AUTHORITY_LABELS[raw] || '';
}

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

// #768: 공감 lives behind a resident session, so its boundary states must stay
// distinguishable. A verification boundary is never reported as "log in again"
// (#765), and a signed-out visitor is never told to verify.
function reactionFailure(status, payload) {
  const code = payload?.error?.code || null;
  let reason = 'server-error';
  if (status === 401) reason = 'login-required';
  else if (status === 403 && code === 'RESIDENT_VERIFICATION_REQUIRED') reason = 'resident-verification-required';
  else if (status === 403) reason = 'forbidden';
  else if (status === 404) reason = 'not-found';
  return { ok: false, reason, status, error: payload?.error || null };
}

function normalizeReaction(payload) {
  const data = payload && typeof payload === 'object' ? payload : null;
  if (!data) return null;
  const count = Number(data.reactionCount);
  return {
    postId: String(data.postId || ''),
    reactionType: String(data.reactionType || 'like'),
    active: data.active === true,
    reactionCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  };
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
  const count = Number(row.reaction_count ?? row.reactionCount);
  const mode = String(row.display_mode ?? row.displayMode ?? '');
  return {
    id: String(row.id || ''),
    sourceName: row.source_name ?? row.sourceName ?? null,
    category: row.category ?? null,
    channel: row.channel ?? null,
    displayMode: NEWS_DISPLAY_MODES.includes(mode) ? mode : 'highlight',
    authority: row.authority ?? null,
    // Presentation label for the server-owned authority key. The key is the
    // contract; the label exists so a page never hardcodes an organisation name.
    authorityLabel: newsAuthorityLabel(row.authority),
    title: String(row.title || ''),
    body: row.body ?? '',
    attachmentObjectKey: row.attachment_object_key ?? row.attachmentObjectKey ?? null,
    reactionCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    publishedAt: row.published_at ?? row.publishedAt ?? null
  };
}

export function createNewsBridge({ apiBase = '', fetchImpl = globalThis.fetch, complexSlug = DANJION_COMPLEX_SLUG } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const slug = encodeURIComponent(complexSlug);
  const root = String(apiBase || '').replace(/\/+$/, '');

  // #768: the 공감 endpoint requires a resident session, so it goes through the
  // canonical DanjionSession session fetch (same lane as the community bridge)
  // instead of the anonymous public read. When the canonical runtime is absent
  // the mutation fails closed rather than firing an unauthenticated request.
  function sessionRequest(path, init) {
    const session = globalThis.DanjionSession;
    if (!session || typeof session.createSessionFetch !== 'function') return null;
    const sessionFetch = session.createSessionFetch(root);
    return sessionFetch(fetchImpl, path, init);
  }

  async function reactionRequest(postId, init) {
    const id = String(postId || '');
    if (!id) return { ok: false, reason: 'validation-error', status: 0, error: null };
    const pending = sessionRequest(`/api/v1/complexes/${slug}/news/posts/${encodeURIComponent(id)}/reaction`, init);
    if (!pending) return { ok: false, reason: 'server-mode-required', status: 0, error: null };
    try {
      const outcome = await pending;
      // The canonical session lane resolves to a wrapped result object, not a
      // Response: { ok, status, data, error, requestId }. A bare Response is
      // only tolerated from isolated fetch stubs, so the 403 error code keeps
      // surviving to reactionFailure either way.
      if (outcome && typeof outcome.json === 'function') {
        const payload = await parseJson(outcome);
        if (!outcome.ok) return reactionFailure(outcome.status, payload);
        return { ok: true, status: outcome.status, data: normalizeReaction(payload?.data), requestId: payload?.requestId ?? null };
      }
      if (!outcome || typeof outcome.ok !== 'boolean') {
        return { ok: false, reason: 'server-error', status: 0, error: null };
      }
      if (!outcome.ok) {
        return reactionFailure(Number(outcome.status) || 0, { error: outcome.error ?? null });
      }
      return {
        ok: true,
        status: Number(outcome.status) || 200,
        data: normalizeReaction(outcome.data),
        requestId: outcome.requestId ?? null
      };
    } catch (error) {
      return { ok: false, reason: 'network-error', status: 0, error };
    }
  }

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
    },
    // Viewer-scoped 공감 state: 401 / 403 boundaries stay explicit so the page
    // can render the correct message instead of a generic failure.
    async getReaction(postId) {
      return reactionRequest(postId, { method: 'GET' });
    },
    async setReaction(postId, active) {
      return reactionRequest(postId, { method: active ? 'POST' : 'DELETE' });
    }
  };
}

globalThis.DanjionNewsBridge = {
  createNewsBridge,
  normalizePost,
  newsAuthorityLabel,
  NEWS_CHANNELS,
  NEWS_DISPLAY_MODES,
  NEWS_AUTHORITY_LABELS,
  DANJION_COMPLEX_SLUG
};
