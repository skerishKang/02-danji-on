import { authenticatedFetch } from './auth-fetch';

export type StorageKind = 'business-image' | 'resident-evidence';
export type StorageMode = 'mock' | 'drive';
export type StorageVisibility = 'public' | 'private';

export interface StoredObject {
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  visibility: StorageVisibility;
  previewUrl?: string;
}

export interface StorageAdapter {
  upload(kind: StorageKind, file: File): Promise<StoredObject>;
  read(objectKey: string): Promise<Blob | null>;
  delete(objectKey: string): Promise<void>;
  resolvePreview?(objectKey: string): Promise<string | null>;
  releasePreview?(object: StoredObject): void;
  releasePreviewUrl?(url: string): void;
}

const STORAGE_POLICY = {
  'business-image': {
    visibility: 'public' as const,
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp'])
  },
  'resident-evidence': {
    visibility: 'private' as const,
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  }
} satisfies Record<StorageKind, { visibility: StorageVisibility; maxBytes: number; mimeTypes: Set<string> }>;

const MOCK_DB_NAME = 'danjion-mock-storage-v2';
const MOCK_STORE_NAME = 'files';

interface MockStoredFile {
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  visibility: StorageVisibility;
  blob: Blob;
}

function safeFileName(value: string) {
  return value.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/[-.]+$/g, '') || 'upload';
}

export function validateStorageFile(kind: StorageKind, file: File) {
  const policy = STORAGE_POLICY[kind];
  if (!policy.mimeTypes.has(file.type)) {
    throw new Error(kind === 'business-image'
      ? '이미지 파일만 업로드할 수 있습니다.'
      : '주민 인증 증빙은 JPG, PNG, WebP 또는 PDF만 업로드할 수 있습니다.');
  }
  if (file.size <= 0) throw new Error('빈 파일은 업로드할 수 없습니다.');
  if (file.size > policy.maxBytes) {
    const limitMb = Math.floor(policy.maxBytes / 1024 / 1024);
    throw new Error(`파일은 ${limitMb}MB 이하만 업로드할 수 있습니다.`);
  }
}

function openMockDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MOCK_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MOCK_STORE_NAME)) {
        db.createObjectStore(MOCK_STORE_NAME, { keyPath: 'objectKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('mock storage database open failed'));
  });
}

async function storeMockFile(record: MockStoredFile) {
  const db = await openMockDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(MOCK_STORE_NAME, 'readwrite');
    transaction.objectStore(MOCK_STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('mock storage write failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('mock storage write aborted'));
  });
  db.close();
}

async function readMockFile(objectKey: string): Promise<MockStoredFile | null> {
  const db = await openMockDb();
  const record = await new Promise<MockStoredFile | undefined>((resolve, reject) => {
    const transaction = db.transaction(MOCK_STORE_NAME, 'readonly');
    const request = transaction.objectStore(MOCK_STORE_NAME).get(objectKey);
    request.onsuccess = () => resolve(request.result as MockStoredFile | undefined);
    request.onerror = () => reject(request.error ?? new Error('mock storage read failed'));
  });
  db.close();
  return record ?? null;
}

async function deleteMockFile(objectKey: string): Promise<void> {
  const db = await openMockDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(MOCK_STORE_NAME, 'readwrite');
    transaction.objectStore(MOCK_STORE_NAME).delete(objectKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('mock storage delete failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('mock storage delete aborted'));
  });
  db.close();
}

export function resetMockStorage(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(MOCK_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('mock storage reset failed'));
    request.onblocked = () => resolve();
  });
}

class MockStorageAdapter implements StorageAdapter {
  async upload(kind: StorageKind, file: File): Promise<StoredObject> {
    validateStorageFile(kind, file);
    const visibility = STORAGE_POLICY[kind].visibility;
    const objectKey = `mock/${visibility}/${kind}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    await storeMockFile({
      objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      visibility,
      blob: file
    });
    return {
      objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      visibility,
      previewUrl: URL.createObjectURL(file)
    };
  }

  async read(objectKey: string): Promise<Blob | null> {
    if (!objectKey.startsWith('mock/')) return null;
    return (await readMockFile(objectKey))?.blob ?? null;
  }

  async delete(objectKey: string): Promise<void> {
    if (!objectKey.startsWith('mock/')) return;
    await deleteMockFile(objectKey);
  }

  async resolvePreview(objectKey: string): Promise<string | null> {
    const blob = await this.read(objectKey);
    return blob ? URL.createObjectURL(blob) : null;
  }

  releasePreview(object: StoredObject) {
    if (object.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(object.previewUrl);
  }

  releasePreviewUrl(url: string) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

function apiBaseUrl() {
  return String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

function storageUrl(path: string, objectKey?: string) {
  const base = `${apiBaseUrl()}${path}`;
  if (!objectKey) return base;
  return `${base}?objectKey=${encodeURIComponent(objectKey)}`;
}

function isPublicDriveKey(objectKey: string) {
  return objectKey.startsWith('gdrive/public/business-image/');
}

function isPrivateDriveKey(objectKey: string) {
  return objectKey.startsWith('gdrive/private/resident-evidence/');
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) {
    throw new Error(payload.error?.message || `Storage request failed (${response.status})`);
  }
  if (payload.data === undefined) throw new Error('Storage response did not include data.');
  return payload.data;
}

class GoogleDriveStorageAdapter implements StorageAdapter {
  async upload(kind: StorageKind, file: File): Promise<StoredObject> {
    validateStorageFile(kind, file);
    const body = new FormData();
    body.append('kind', kind);
    body.append('complexSlug', import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill');
    body.append('file', file, safeFileName(file.name));

    const response = await authenticatedFetch(storageUrl('/api/v1/storage/objects'), {
      method: 'POST',
      body
    }, 'resident');
    const stored = await parseJsonResponse<StoredObject>(response);
    return { ...stored, previewUrl: URL.createObjectURL(file) };
  }

  async read(objectKey: string): Promise<Blob | null> {
    const endpoint = isPublicDriveKey(objectKey)
      ? '/api/v1/storage/public'
      : isPrivateDriveKey(objectKey)
        ? '/api/v1/storage/private'
        : null;
    if (!endpoint) return null;
    const url = storageUrl(endpoint, objectKey);
    const response = endpoint.endsWith('/private')
      ? await authenticatedFetch(url, {}, 'resident')
      : await fetch(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as ApiEnvelope<never>;
      throw new Error(payload.error?.message || `Storage read failed (${response.status})`);
    }
    return response.blob();
  }

  async delete(objectKey: string): Promise<void> {
    if (!objectKey.startsWith('gdrive/')) return;
    const response = await authenticatedFetch(storageUrl('/api/v1/storage/objects', objectKey), {
      method: 'DELETE'
    }, 'resident');
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as ApiEnvelope<never>;
      throw new Error(payload.error?.message || `Storage delete failed (${response.status})`);
    }
  }

  async resolvePreview(objectKey: string): Promise<string | null> {
    return isPublicDriveKey(objectKey) ? storageUrl('/api/v1/storage/public', objectKey) : null;
  }

  releasePreview(object: StoredObject) {
    if (object.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(object.previewUrl);
  }

  releasePreviewUrl(url: string) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

export const storageAdapter: StorageAdapter = import.meta.env.VITE_STORAGE_MODE === 'drive'
  ? new GoogleDriveStorageAdapter()
  : new MockStorageAdapter();