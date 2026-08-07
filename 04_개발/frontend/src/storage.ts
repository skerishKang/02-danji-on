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
  releasePreview?(object: StoredObject): void;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function safeFileName(value: string) {
  return value.normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
}

function validateImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있습니다.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('이미지는 8MB 이하만 업로드할 수 있습니다.');
}

class MockStorageAdapter implements StorageAdapter {
  async upload(kind: StorageKind, file: File): Promise<StoredObject> {
    validateImage(file);
    const objectKey = `mock/${kind}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    return {
      objectKey,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      previewUrl: URL.createObjectURL(file)
    };
  }

  releasePreview(object: StoredObject) {
    if (object.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(object.previewUrl);
  }
}

class R2StorageAdapter implements StorageAdapter {
  async upload(): Promise<StoredObject> {
    throw new Error('R2 storage adapter is not configured yet. Use VITE_STORAGE_MODE=mock until Cloudflare is connected.');
  }
}

export const storageAdapter: StorageAdapter = import.meta.env.VITE_STORAGE_MODE === 'r2'
  ? new R2StorageAdapter()
  : new MockStorageAdapter();
