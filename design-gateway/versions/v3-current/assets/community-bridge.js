(() => {
  'use strict';

  const POST_KINDS = ['question', 'together', 'resident_story', 'life_report', 'greeting'];
  const DEFAULT_COMPLEX_SLUG = 'banglim-myeongji-roadhill';
  const MAX_TITLE_CHARS = 160;
  const MAX_BODY_CHARS = 10000;
  const MAX_COMMENT_CHARS = 300;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normalizeAuthor(raw) {
    const author = raw && typeof raw === 'object' ? raw : {};
    return { nickname: String(author.nickname ?? '') };
  }

  function normalizePost(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = String(raw.kind || '');
    if (!POST_KINDS.includes(kind)) return null;
    const reactions = Number(raw.reactionCount);
    const comments = Number(raw.commentCount);
    return {
      id: String(raw.id || ''),
      kind,
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      status: String(raw.status || ''),
      author: normalizeAuthor(raw.author),
      reactionCount: Number.isFinite(reactions) && reactions > 0 ? Math.floor(reactions) : 0,
      commentCount: Number.isFinite(comments) && comments > 0 ? Math.floor(comments) : 0,
      viewerLiked: raw.viewerLiked === true,
      publishedAt: raw.publishedAt ?? null,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null
    };
  }

  function normalizeComment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || ''),
      postId: String(raw.postId || ''),
      body: String(raw.body ?? ''),
      status: String(raw.status || ''),
      author: normalizeAuthor(raw.author),
      publishedAt: raw.publishedAt ?? null,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null
    };
  }

  function failureMode(result) {
    return result.reason === 'auth-required' ? 'auth-required' : 'error';
  }

  // Canonical apiBase/session semantics come from DanjionSession (#324).
  // This bridge never parses location.search itself and never persists state.
  function createCommunityBridge(options = {}) {
    const session = globalThis.DanjionSession;
    if (!session || typeof session.createSessionFetch !== 'function') {
      throw new TypeError('DanjionSession canonical runtime is required');
    }
    const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    const apiBase = String(options.apiBase || '').replace(/\/+$/, '');
    const slug = encodeURIComponent(String(options.complexSlug || DEFAULT_COMPLEX_SLUG));
    const base = `/api/v1/complexes/${slug}/community`;
    const sessionFetch = session.createSessionFetch(apiBase);
    const request = (path, init) => sessionFetch(fetchImpl, path, init);

    function serverOnly() {
      return Boolean(apiBase);
    }

    function postPath(postId) {
      const id = String(postId || '').toLowerCase();
      return { id, valid: UUID.test(id) };
    }

    return {
      async listPosts(kind, options = {}) {
        const topic = kind == null ? null : String(kind);
        if (topic !== null && !POST_KINDS.includes(topic)) {
          return { mode: 'client', error: 'POST_KIND_INVALID', posts: [] };
        }
        if (!serverOnly()) return { mode: 'static', posts: [] };
        const params = new URLSearchParams();
        if (topic) params.set('kind', topic);
        const limit = Number(options.limit);
        params.set('limit', String(Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 20));
        const result = await request(`${base}/posts?${params.toString()}`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, posts: [] };
        const rows = Array.isArray(result.data) ? result.data : [];
        return { mode: 'server', status: result.status, posts: rows.map(normalizePost).filter(Boolean) };
      },

      async getPost(postId) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { mode: 'static', error: 'SERVER_MODE_REQUIRED', post: null };
        if (!valid) return { mode: 'client', error: 'POST_ID_INVALID', post: null };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, post: null };
        return { mode: 'server', status: result.status, post: normalizePost(result.data) };
      },

      async createPost(input = {}) {
        const kind = String(input.kind || '');
        if (!POST_KINDS.includes(kind)) return { ok: false, mode: 'client', error: 'POST_KIND_INVALID' };
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        const title = String(input.title || '').trim();
        if (!title || title.length > MAX_TITLE_CHARS) return { ok: false, mode: 'client', error: 'POST_TITLE_INVALID' };
        const body = String(input.body || '').trim();
        if (!body || body.length > MAX_BODY_CHARS) return { ok: false, mode: 'client', error: 'POST_BODY_INVALID' };
        const result = await request(`${base}/posts`, {
          method: 'POST',
          body: JSON.stringify({ kind, title, body })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, post: normalizePost(result.data) };
      },

      async listComments(postId) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { mode: 'static', postId: id, comments: [] };
        if (!valid) return { mode: 'client', error: 'POST_ID_INVALID', postId: id, comments: [] };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}/comments`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, postId: id, comments: [] };
        const rows = Array.isArray(result.data) ? result.data : [];
        return { mode: 'server', status: result.status, postId: id, comments: rows.map(normalizeComment).filter(Boolean) };
      },

      async addComment(postId, body) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID' };
        const text = String(body || '').trim();
        if (!text || text.length > MAX_COMMENT_CHARS) return { ok: false, mode: 'client', error: 'COMMENT_BODY_INVALID' };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: text })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, comment: normalizeComment(result.data) };
      },

      async setReaction(postId, active) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID' };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}/reactions`, {
          method: active ? 'POST' : 'DELETE'
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, active: result.data?.active === true };
      }
    };
  }

  globalThis.DanjionCommunityBridge = {
    createCommunityBridge,
    normalizePost,
    normalizeComment,
    POST_KINDS,
    DEFAULT_COMPLEX_SLUG
  };
})();
