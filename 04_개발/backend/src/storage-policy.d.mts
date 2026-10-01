export type StorageKind = 'business-image' | 'resident-evidence' | 'application-document' | 'official-news-image';
export type StorageVisibility = 'public' | 'private';
export interface StoragePolicy {
  visibility: StorageVisibility;
  maxBytes: number;
  maxFiles: number;
  mimeTypes: readonly string[];
}
export const STORAGE_UPLOAD_POLICIES: Readonly<Record<StorageKind, StoragePolicy>>;
export function safeStorageFileName(value: string): string;
export type StorageValidationResult =
  | { ok: true; kind: StorageKind; policy: StoragePolicy }
  | { ok: false; code: string; message: string };
export function validateStorageUpload(
  kind: string,
  files: ArrayLike<{ size: number; type: string; name?: string }> | Iterable<{ size: number; type: string; name?: string }>
): StorageValidationResult;

export type SupportedStorageMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export function detectStorageMimeType(file: Blob): Promise<SupportedStorageMimeType | null>;
export type StorageSignatureValidationResult =
  | { ok: true; mimeType: SupportedStorageMimeType }
  | { ok: false; code: string; message: string };
export function validateStorageUploadSignature(
  file: Blob & { type: string },
  policy: StoragePolicy
): Promise<StorageSignatureValidationResult>;
