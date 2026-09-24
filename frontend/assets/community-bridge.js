(() => {
  'use strict';

  const POST_KINDS = ['question', 'together', 'resident_story', 'life_report', 'greeting'];
  const DEFAULT_COMPLEX_SLUG = 'banglim-myeongji-roadhill';
  const MAX_TITLE_CHARS = 160;
  const MAX_BODY_CHARS = 10000;
  const MAX_COMMENT_CHARS = 300;
  const MAX_CATEGORY_CHARS = 40;
  const MAX_REPORT_DETAIL_CHARS = 1000;
  const REPORT_TARGET_TYPES = Object.freeze(['post', 'comment']);
  const REPORT_REASONS = Object.freeze(['abuse', 'threat', 'privacy', 'defamation_risk', 'spam', 'other']);
  // Canonical per-kind 말머리 allowlist (#767). Mirrors the server-authoritative
  // list in 04_개발/backend/src/community-resident-v1.ts; the bridge never invents
  // a category the server would reject. Kinds absent here can never send one.
  const POST_CATEGORIES = Object.freeze({
    question: Object.freeze(['생활·살림', '단지시설', '이웃추천', '기타']),
    together: Object.freeze(['산책·운동', '취미활동', '육아 같이해요', '공동구매', '강아지 산책 같이해요'])
  });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normalizeAuthor(raw) {
    const author = raw && typeof raw === 'object' ? raw : {};
    return { nickname: String(author.nickname ?? '') };
  }

  function trimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
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
      category: raw.category == null || raw.category === '' ? null : String(raw.category),
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      status: String(raw.status || ''),
      author: normalizeAuthor(raw.author),
      reactionCount: Number.isFinite(reactions) && reactions > 0 ? Math.floor(reactions) : 0,
      commentCount: Number.isFinite(comments) && comments > 0 ? Math.floor(comments) : 0,
      viewerLiked: raw.viewerLiked === true,
      viewerCanEdit: raw.viewerCanEdit === true,
      viewerCanDelete: raw.viewerCanDelete === true,
      viewerCanReport: raw.viewerCanReport === true,
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
      viewerCanDelete: raw.viewerCanDelete === true,
      viewerCanReport: raw.viewerCanReport === true,
      publishedAt: raw.publishedAt ?? null,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null
    };
  }

  function normalizeReply(raw) {
    const base = normalizeComment(raw);
    if (!base) return null;
    return {
      ...base,
      parentCommentId: String(raw.parentCommentId || '')
    };
  }

  function failureMode(result) {
    return result.reason === 'auth-required' ? 'auth-required' : 'error';
  }

  // Issue #810: carry the bounded server-side auth-bridge disposition through
  // the bridge so the page can distinguish "your session really ended" from
  // "the server-side session->bearer bridge failed". The value is a closed
  // non-sensitive enum from the facade (`x-danjion-auth-bridge`); it is never a
  // credential and this bridge still persists nothing.
  function failureDetail(result) {
    if (!result || result.reason !== 'auth-required') return {};
    const authBridge = typeof result.authBridge === 'string' ? result.authBridge : null;
    return authBridge ? { authBridge } : {};
  }

  function normalizeDeleted(raw, fallbackId) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(data.id || fallbackId),
      status: String(data.status || '')
    };
  }

  function normalizeReport(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const createdAt = data.createdAt == null ? null : String(data.createdAt);
    return {
      id: data.id == null ? null : String(data.id),
      status: String(data.status || ''),
      createdAt
    };
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
    const canonicalProduction = typeof session.isCanonicalProduction === 'function'
      && session.isCanonicalProduction(options.location);
    const slug = encodeURIComponent(String(options.complexSlug || DEFAULT_COMPLEX_SLUG));
    const base = `/api/v1/complexes/${slug}/community`;
    const sessionFetch = session.createSessionFetch(apiBase);
    const request = (path, init) => sessionFetch(fetchImpl, path, init);

    function serverOnly() {
      return Boolean(apiBase) || canonicalProduction;
    }

    function postPath(postId) {
      const id = String(postId || '').toLowerCase();
      return { id, valid: UUID.test(id) };
    }

    function commentPath(commentId) {
      const id = String(commentId || '').toLowerCase();
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
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), posts: [] };
        const rows = Array.isArray(result.data) ? result.data : [];
        return { mode: 'server', status: result.status, posts: rows.map(normalizePost).filter(Boolean) };
      },

      async getPost(postId) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { mode: 'static', error: 'SERVER_MODE_REQUIRED', post: null };
        if (!valid) return { mode: 'client', error: 'POST_ID_INVALID', post: null };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), post: null };
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
        const category = input.category == null ? '' : String(input.category).trim();
        const allowlist = POST_CATEGORIES[kind] || null;
        if (category && (category.length > MAX_CATEGORY_CHARS || !allowlist || !allowlist.includes(category))) {
          return { ok: false, mode: 'client', error: 'POST_CATEGORY_INVALID' };
        }
        const payload = { kind, title, body };
        if (category) payload.category = category;
        const result = await request(`${base}/posts`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result) };
        return { ok: true, mode: 'server', status: result.status, post: normalizePost(result.data) };
      },

      async updatePost(postId, input = {}) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED', post: null };
        if (!valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID', post: null };
        const source = input && typeof input === 'object' ? input : {};
        const title = trimmedString(source.title);
        if (!title || title.length > MAX_TITLE_CHARS) return { ok: false, mode: 'client', error: 'POST_TITLE_INVALID', post: null };
        const body = trimmedString(source.body);
        if (!body || body.length > MAX_BODY_CHARS) return { ok: false, mode: 'client', error: 'POST_BODY_INVALID', post: null };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, body })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), post: null };
        return { ok: true, mode: 'server', status: result.status, post: normalizePost(result.data) };
      },

      async deletePost(postId) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED', post: null };
        if (!valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID', post: null };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), post: null };
        const post = normalizeDeleted(result.data, id);
        return { ok: true, mode: 'server', status: result.status, deleted: post.status === 'deleted', post };
      },

      async listComments(postId) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { mode: 'static', postId: id, comments: [] };
        if (!valid) return { mode: 'client', error: 'POST_ID_INVALID', postId: id, comments: [] };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}/comments`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), postId: id, comments: [] };
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
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result) };
        return { ok: true, mode: 'server', status: result.status, comment: normalizeComment(result.data) };
      },

      async deleteComment(commentId) {
        const { id, valid } = commentPath(commentId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED', comment: null };
        if (!valid) return { ok: false, mode: 'client', error: 'COMMENT_ID_INVALID', comment: null };
        const result = await request(`${base}/comments/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), comment: null };
        const comment = normalizeDeleted(result.data, id);
        return { ok: true, mode: 'server', status: result.status, deleted: comment.status === 'deleted', comment };
      },

      async listReplies(postId, parentCommentId) {
        const post = postPath(postId);
        const parent = postPath(parentCommentId);
        if (!serverOnly()) return { mode: 'static', postId: post.id, parentCommentId: parent.id, replies: [] };
        if (!post.valid) return { mode: 'client', error: 'POST_ID_INVALID', postId: post.id, parentCommentId: parent.id, replies: [] };
        if (!parent.valid) return { mode: 'client', error: 'COMMENT_ID_INVALID', postId: post.id, parentCommentId: parent.id, replies: [] };
        const result = await request(`${base}/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(parent.id)}/replies`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), postId: post.id, parentCommentId: parent.id, replies: [] };
        const rows = Array.isArray(result.data) ? result.data : [];
        return { mode: 'server', status: result.status, postId: post.id, parentCommentId: parent.id, replies: rows.map(normalizeReply).filter(Boolean) };
      },

      async addReply(postId, parentCommentId, body) {
        const post = postPath(postId);
        const parent = postPath(parentCommentId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!post.valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID' };
        if (!parent.valid) return { ok: false, mode: 'client', error: 'COMMENT_ID_INVALID' };
        const text = String(body || '').trim();
        if (!text || text.length > MAX_COMMENT_CHARS) return { ok: false, mode: 'client', error: 'COMMENT_BODY_INVALID' };
        const result = await request(`${base}/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(parent.id)}/replies`, {
          method: 'POST',
          body: JSON.stringify({ body: text })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result) };
        return { ok: true, mode: 'server', status: result.status, reply: normalizeReply(result.data) };
      },

      async setReaction(postId, active) {
        const { id, valid } = postPath(postId);
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!valid) return { ok: false, mode: 'client', error: 'POST_ID_INVALID' };
        const result = await request(`${base}/posts/${encodeURIComponent(id)}/reactions`, {
          method: active ? 'POST' : 'DELETE'
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result) };
        return { ok: true, mode: 'server', status: result.status, active: result.data?.active === true };
      },

      async reportTarget(input = {}) {
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED', report: null };
        const source = input && typeof input === 'object' ? input : {};
        const targetType = trimmedString(source.targetType);
        if (!REPORT_TARGET_TYPES.includes(targetType)) return { ok: false, mode: 'client', error: 'REPORT_TARGET_TYPE_INVALID', report: null };
        const targetId = trimmedString(source.targetId).toLowerCase();
        if (!UUID.test(targetId)) return { ok: false, mode: 'client', error: 'REPORT_TARGET_ID_INVALID', report: null };
        const reason = trimmedString(source.reason);
        if (!REPORT_REASONS.includes(reason)) return { ok: false, mode: 'client', error: 'REPORT_REASON_INVALID', report: null };
        const detail = trimmedString(source.detail);
        if (detail.length > MAX_REPORT_DETAIL_CHARS) return { ok: false, mode: 'client', error: 'REPORT_DETAIL_INVALID', report: null };
        const result = await request(`${base}/reports`, {
          method: 'POST',
          body: JSON.stringify({ targetType, targetId, reason, detail })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error, ...failureDetail(result), report: null };
        const report = normalizeReport(result.data);
        return { ok: true, mode: 'server', status: result.status, duplicate: report.status === 'already_reported', report };
      }
    };
  }

  globalThis.DanjionCommunityBridge = {
    createCommunityBridge,
    normalizePost,
    normalizeComment,
    normalizeReply,
    POST_KINDS,
    POST_CATEGORIES,
    MAX_CATEGORY_CHARS,
    MAX_REPORT_DETAIL_CHARS,
    REPORT_TARGET_TYPES,
    REPORT_REASONS,
    DEFAULT_COMPLEX_SLUG
  };
})();
