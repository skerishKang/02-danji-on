export const STORAGE_UPLOAD_POLICIES = Object.freeze({
  'business-image': Object.freeze({
    visibility: 'public',
    maxBytes: 8 * 1024 * 1024,
    maxFiles: 1,
    mimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
  }),
  'resident-evidence': Object.freeze({
    visibility: 'private',
    maxBytes: 10 * 1024 * 1024,
    maxFiles: 1,
    mimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  })
});

export function safeStorageFileName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[-.]+$/g, '')
    .slice(0, 120) || 'upload';
}

export function validateStorageUpload(kind, files) {
  const policy = STORAGE_UPLOAD_POLICIES[kind];
  if (!policy) return { ok: false, code: 'INVALID_STORAGE_KIND', message: 'Unsupported storage kind' };
  const list = Array.from(files || []);
  if (list.length !== 1 || list.length > policy.maxFiles) {
    return { ok: false, code: 'INVALID_FILE_COUNT', message: `Exactly ${policy.maxFiles} file must be uploaded` };
  }
  const file = list[0];
  if (!file || typeof file.size !== 'number' || typeof file.type !== 'string') {
    return { ok: false, code: 'INVALID_FILE', message: 'A valid file is required' };
  }
  if (file.size <= 0) return { ok: false, code: 'EMPTY_FILE', message: 'Empty files are not allowed' };
  if (file.size > policy.maxBytes) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: `File exceeds ${Math.floor(policy.maxBytes / 1024 / 1024)}MB limit` };
  }
  if (!policy.mimeTypes.includes(file.type)) {
    return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported file type' };
  }
  return { ok: true, kind, policy };
}
