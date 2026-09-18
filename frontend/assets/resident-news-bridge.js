export const DANJION_RESIDENT_NEWS_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function row(value) {
  return value && typeof value === 'object' ? value : {};
}

function text(value) {
  return value == null ? '' : String(value);
}

function optionalText(value) {
  const raw = text(value);
  return raw === '' ? null : raw;
}

function validationError() {
  return { ok: false, reason: 'validation-error', status: 0, error: null };
}

// Resident-news lane bridge (#346, Leaf B10). The authority is the merged
// resident-news-v1 backend: GET /api/v1/complexes/{slug}/resident-news (published
// feed) and GET /api/v1/complexes/{slug}/resident-news/{uuid} (published detail).
// Transport and envelope semantics are delegated to the shared #324 DanjionSession
// runtime (credentials include, {data,requestId} envelope, 401/403 -> auth-required,
// fail-closed on 4xx/5xx/network). Nothing is persisted in the browser: this bridge
// never writes browser storage, cookies or client-side databases, and it never
// fabricates rows the server did not return.
export function normalizeResidentNewsPost(value) {
  const raw = row(value);
  return {
    id: text(raw.id),
    title: text(raw.title),
    body: text(raw.body),
    publishedAt: optionalText(raw.publishedAt != null ? raw.publishedAt : raw.published_at),
    createdAt: optionalText(raw.createdAt != null ? raw.createdAt : raw.created_at)
  };
}

export function normalizeResidentNewsSubmission(value) {
  const raw = row(value);
  return {
    id: text(raw.id),
    title: text(raw.title),
    status: text(raw.status),
    publishedPostId: optionalText(raw.publishedPostId != null ? raw.publishedPostId : raw.published_post_id),
    createdAt: optionalText(raw.createdAt != null ? raw.createdAt : raw.created_at),
    updatedAt: optionalText(raw.updatedAt != null ? raw.updatedAt : raw.updated_at)
  };
}

function authorizationBoundary(result) {
  if (result.ok) return result;
  const code = text(result.error?.code);
  if (result.status === 403 && (code === 'RESIDENT_VERIFICATION_REQUIRED' || code === 'HOUSEHOLD_ASSOCIATION_REQUIRED')) {
    return { ...result, reason: 'resident-verification-required' };
  }
  if (result.status === 403) return { ...result, reason: 'forbidden' };
  return result;
}

export function createResidentNewsBridge({
  apiBase = '',
  fetchImpl = globalThis.fetch,
  Session = globalThis.DanjionSession,
  complexSlug = DANJION_RESIDENT_NEWS_COMPLEX_SLUG,
  headers = {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  if (!Session || typeof Session.request !== 'function' || typeof Session.joinUrl !== 'function') {
    throw new TypeError('DanjionSession runtime is required');
  }
  const base = String(apiBase || '').replace(/\/+$/, '');
  const complex = String(complexSlug || DANJION_RESIDENT_NEWS_COMPLEX_SLUG);
  const slug = encodeURIComponent(complex);
  const feedPath = `/api/v1/complexes/${slug}/resident-news`;
  const ownSubmissionsPath = `/api/v1/me/resident-news/submissions?complexSlug=${encodeURIComponent(complex)}`;

  function call(path, init = {}) {
    return Session.request(fetchImpl, Session.joinUrl(base, path), {
      ...init,
      headers: { ...headers, ...(init.headers || {}) }
    });
  }

  return {
    // Published feed only; rows without a server-issued UUID are dropped rather
    // than rendered with a fabricated identity.
    async listPosts() {
      const result = authorizationBoundary(await call(feedPath, { method: 'GET' }));
      if (!result.ok) return { ...result, posts: [] };
      const data = row(result.data);
      const posts = (Array.isArray(data.posts) ? data.posts.map(normalizeResidentNewsPost) : [])
        .filter((post) => UUID.test(post.id));
      return { ...result, posts };
    },
    // Detail route is UUID-only on the backend, so a malformed id is rejected
    // client-side without touching the network. A 404 stays a 404.
    async getPost(postId) {
      const id = text(postId).trim().toLowerCase();
      if (!UUID.test(id)) return validationError();
      const result = authorizationBoundary(await call(`${feedPath}/${id}`, { method: 'GET' }));
      if (!result.ok) return result;
      const post = normalizeResidentNewsPost(result.data);
      return { ...result, post: UUID.test(post.id) ? post : null };
    },
    async submit(input = {}) {
      const title = text(input.title).trim();
      const body = text(input.body).trim();
      if (!title || !body) return validationError();
      const result = authorizationBoundary(await call(`${feedPath}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body })
      }));
      if (!result.ok) return result;
      const submission = normalizeResidentNewsSubmission(result.data);
      return { ...result, submission: UUID.test(submission.id) ? submission : null };
    },
    async listOwnSubmissions() {
      const result = authorizationBoundary(await call(ownSubmissionsPath, { method: 'GET' }));
      if (!result.ok) return { ...result, submissions: [] };
      const data = row(result.data);
      const submissions = (Array.isArray(data.submissions) ? data.submissions.map(normalizeResidentNewsSubmission) : [])
        .filter((submission) => UUID.test(submission.id));
      return { ...result, submissions };
    }
  };
}
