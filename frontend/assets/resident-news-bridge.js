export const DANJION_RESIDENT_NEWS_COMPLEX_SLUG = 'banglim-myeongji-roadhill';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_ATTACHMENT_KEY = /^gdrive\/private\/application-document\/[A-Za-z0-9_-]{10,200}$/;
const ATTACHMENT_TYPES = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;

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
    attachmentCount: Number(raw.attachmentCount != null ? raw.attachmentCount : raw.attachment_count || 0),
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

  async function uploadAttachment(file, idempotencyKey) {
    if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') return validationError();
    if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, reason: 'file-too-large', status: 413, error: null };
    }
    if (!ATTACHMENT_TYPES.has(file.type)) {
      return { ok: false, reason: 'file-type', status: 415, error: null };
    }
    const key = text(idempotencyKey).trim();
    if (!/^[A-Za-z0-9._:-]{8,80}$/.test(key)) return validationError();

    const form = new FormData();
    form.set('kind', 'application-document');
    form.set('complexSlug', complex);
    form.set('file', file);
    const uploadHeaders = new Headers(headers);
    uploadHeaders.delete('content-type');
    uploadHeaders.set('idempotency-key', key);

    try {
      const response = await fetchImpl(Session.joinUrl(base, '/api/v1/storage/objects'), {
        method: 'POST',
        credentials: 'include',
        headers: uploadHeaders,
        body: form
      });
      const payload = await response.json().catch(() => null);
      const error = payload && payload.error ? payload.error : null;
      if (!response.ok) {
        const code = text(error?.code);
        if (response.status === 401) return { ok: false, reason: 'auth-required', status: 401, error };
        if (response.status === 403 && (code === 'RESIDENT_VERIFICATION_REQUIRED' || code === 'HOUSEHOLD_ASSOCIATION_REQUIRED')) {
          return { ok: false, reason: 'resident-verification-required', status: 403, error };
        }
        if (response.status === 403) return { ok: false, reason: 'forbidden', status: 403, error };
        if (response.status === 413 || code === 'FILE_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE') {
          return { ok: false, reason: 'file-too-large', status: response.status, error };
        }
        if (response.status === 415 || code === 'UNSUPPORTED_MEDIA_TYPE') {
          return { ok: false, reason: 'file-type', status: response.status, error };
        }
        return { ok: false, reason: 'server-error', status: response.status, error };
      }
      const data = row(payload?.data);
      const objectKey = text(data.objectKey);
      if (!PRIVATE_ATTACHMENT_KEY.test(objectKey)) {
        return { ok: false, reason: 'server-error', status: response.status, error: null };
      }
      return { ok: true, status: response.status, objectKey, data, requestId: payload?.requestId ?? null };
    } catch (error) {
      return { ok: false, reason: 'network-error', status: 0, error };
    }
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
    uploadAttachment,
    async submit(input = {}) {
      const title = text(input.title).trim();
      const body = text(input.body).trim();
      const attachmentObjectKeys = Array.isArray(input.attachmentObjectKeys)
        ? input.attachmentObjectKeys.map((value) => text(value).trim())
        : [];
      if (!title || !body || attachmentObjectKeys.length > MAX_ATTACHMENTS) return validationError();
      if (new Set(attachmentObjectKeys).size !== attachmentObjectKeys.length || attachmentObjectKeys.some((value) => !PRIVATE_ATTACHMENT_KEY.test(value))) {
        return validationError();
      }
      const submissionPayload = attachmentObjectKeys.length ? { title, body, attachmentObjectKeys } : { title, body };
      const result = authorizationBoundary(await call(`${feedPath}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submissionPayload)
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
