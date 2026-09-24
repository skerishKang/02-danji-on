(function (global) {
  'use strict';

  const OFFICIAL_NEWS_IMAGE_KEY = /^gdrive\/public\/official-news-image\/[A-Za-z0-9_-]{10,200}$/;
  const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
  const IMAGE_TYPE_SET = new Set(IMAGE_TYPES);
  const MAX_BYTES = 8 * 1024 * 1024;

  function join(base, path) {
    return String(base || '').replace(/\/+$/, '') + path;
  }

  function validateFile(file) {
    if (!file || !Number(file.size)) return { ok: false, message: '빈 사진은 첨부할 수 없습니다.' };
    if (!IMAGE_TYPE_SET.has(String(file.type || ''))) {
      return { ok: false, message: '공식소식 사진은 JPG, PNG, WebP만 첨부할 수 있습니다.' };
    }
    if (Number(file.size) > MAX_BYTES) {
      return { ok: false, message: '공식소식 사진은 파일당 최대 8MB입니다.' };
    }
    return { ok: true };
  }

  async function uploadOfficialNewsImage(fetchImpl, apiBase, file, idempotencyKey, complexSlug) {
    if (typeof fetchImpl !== 'function') return { ok: false, status: 0, code: 'FETCH_REQUIRED', message: '사진 업로드를 시작할 수 없습니다.' };
    const valid = validateFile(file);
    if (!valid.ok) return { ok: false, status: 0, code: 'INVALID_FILE', message: valid.message };
    const key = String(idempotencyKey || '').trim();
    const slug = String(complexSlug || '').trim();
    if (!key || !slug) return { ok: false, status: 0, code: 'INVALID_UPLOAD_CONTEXT', message: '사진 업로드 정보를 확인할 수 없습니다.' };

    const body = new FormData();
    body.set('kind', 'official-news-image');
    body.set('complexSlug', slug);
    body.set('file', file);

    try {
      const response = await fetchImpl(join(apiBase, '/api/v1/storage/objects'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'idempotency-key': key },
        body
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          code: String(payload?.error?.code || ''),
          message: String(payload?.error?.message || '사진 업로드에 실패했습니다.')
        };
      }
      const objectKey = String(payload?.data?.objectKey || '');
      if (!OFFICIAL_NEWS_IMAGE_KEY.test(objectKey)) {
        return { ok: false, status: response.status, code: 'INVALID_OBJECT_KEY', message: '사진 저장 응답을 검증할 수 없습니다.' };
      }
      return { ok: true, status: response.status, objectKey };
    } catch (_) {
      return { ok: false, status: 0, code: 'NETWORK_ERROR', message: '사진 업로드 연결에 실패했습니다.' };
    }
  }

  async function deleteOfficialNewsImage(fetchImpl, apiBase, objectKey) {
    const key = String(objectKey || '');
    if (!OFFICIAL_NEWS_IMAGE_KEY.test(key)) return { ok: false, status: 0, code: 'INVALID_OBJECT_KEY' };
    if (typeof fetchImpl !== 'function') return { ok: false, status: 0, code: 'FETCH_REQUIRED' };
    try {
      const response = await fetchImpl(join(apiBase, '/api/v1/storage/objects') + '?objectKey=' + encodeURIComponent(key), {
        method: 'DELETE',
        credentials: 'include'
      });
      const payload = await response.json().catch(() => null);
      return response.ok
        ? { ok: true, status: response.status }
        : { ok: false, status: response.status, code: String(payload?.error?.code || ''), message: String(payload?.error?.message || '') };
    } catch (_) {
      return { ok: false, status: 0, code: 'NETWORK_ERROR' };
    }
  }

  global.DanjionAdminOfficialNewsStorage = Object.freeze({
    OFFICIAL_NEWS_IMAGE_KEY,
    IMAGE_TYPES,
    MAX_BYTES,
    validateFile,
    uploadOfficialNewsImage,
    deleteOfficialNewsImage
  });
})(typeof window !== 'undefined' ? window : globalThis);
