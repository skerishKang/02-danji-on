export type StorageKind = 'business-image' | 'resident-evidence';
export type StorageMode = 'mock' | 'r2';

export interface StoredObject {
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  previewUrl?: string;
}

export interface StorageAdapter {
  upload(kind: StorageKind, file: File): Promise<StoredObject>;
  resolvePreview?(objectKey: string): Promise<string | null>;
  releasePreview?(object: StoredObject): void;
  releasePreviewUrl?(url: string): void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MOCK_DB_NAME = 'danjion-mock-storage-v1';
const MOCK_STORE_NAME = 'files';

interface MockStoredFile {
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  blob: Blob;
}

function safeFileName(value: string) {
  return value.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

function validateImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있습니다.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 8MB 이하만 업로드할 수 있습니다.');
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
    validateImage(file);
    const objectKey = `mock/${kind}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    await storeMockFile({
      objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      blob: file
    });
    return {
      objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      previewUrl: URL.createObjectURL(file)
    };
  }

  async resolvePreview(objectKey: string): Promise<string | null> {
    if (!objectKey.startsWith('mock/')) return null;
    const record = await readMockFile(objectKey);
    return record?.blob ? URL.createObjectURL(record.blob) : null;
  }

  releasePreview(object: StoredObject) {
    if (object.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(object.previewUrl);
  }

  releasePreviewUrl(url: string) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

class R2StorageAdapter implements StorageAdapter {
  async upload(): Promise<StoredObject> {
    throw new Error('R2 storage adapter is not configured yet. Use VITE_STORAGE_MODE=mock until Cloudflare is connected.');
  }

  async resolvePreview(): Promise<string | null> {
    return null;
  }
}

export const storageAdapter: StorageAdapter = import.meta.env.VITE_STORAGE_MODE === 'r2'
  ? new R2StorageAdapter()
  : new MockStorageAdapter();
