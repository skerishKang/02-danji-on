export const STORAGE_UPLOAD_POLICIES = Object.freeze({
  'business-image': Object.freeze({
    visibility: 'public',
    maxBytes: 8 * 1024 * 1024,
    maxFiles: 1,
    mimeTypes: Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
  }),
  // #844: official apartment-news public attachment image. Same bounded public
  // image envelope as business-image, but a distinct kind/namespace/lifecycle
  // lane (gdrive/public/official-news-image/<fileId>).
  'official-news-image': Object.freeze({
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
  }),
  'application-document': Object.freeze({
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


export async function detectStorageMimeType(file) {
  if (!file || typeof file.slice !== 'function') return null;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  if (bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp';
  }
  if (bytes.length >= 5 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return 'application/pdf';
  }
  return null;
}

export async function validateStorageUploadSignature(file, policy) {
  const detectedMimeType = await detectStorageMimeType(file);
  if (!detectedMimeType || !policy?.mimeTypes?.includes(detectedMimeType)) {
    return { ok: false, code: 'UNSUPPORTED_MEDIA_SIGNATURE', message: 'Unsupported file content' };
  }
  if (file.type !== detectedMimeType) {
    return { ok: false, code: 'MEDIA_TYPE_MISMATCH', message: 'Declared file type does not match file content' };
  }
  return { ok: true, mimeType: detectedMimeType };
}
