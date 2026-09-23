export type R2StorageEnv = {
  STORAGE_MODE?: string;
  DANJION_STORAGE?: R2Bucket;
};

export type R2Metadata = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
};

export function r2Enabled(env: R2StorageEnv): boolean {
  return env.STORAGE_MODE === 'r2' && Boolean(env.DANJION_STORAGE);
}

export function r2Key(kind: string, fileId: string): string {
  const visibility = kind === 'application-document' ? 'private' : 'public';
  return `gdrive/${visibility}/${kind}/${fileId}`;
}

export async function r2Head(env: R2StorageEnv, kind: string, fileId: string): Promise<R2Metadata | null> {
  const bucket = env.DANJION_STORAGE;
  if (!bucket) throw new Error('R2 storage binding is not configured');
  const key = r2Key(kind, fileId);
  const object = await bucket.head(key);
  if (!object) return null;
  return {
    id: fileId,
    name: object.customMetadata?.originalFileName || key.split('/').pop() || fileId,
    mimeType: object.httpMetadata?.contentType || 'application/octet-stream',
    size: String(object.size),
    trashed: false,
    appProperties: object.customMetadata
  };
}

export async function r2Put(
  env: R2StorageEnv,
  kind: string,
  fileId: string,
  file: File,
  metadata: Record<string, string>
): Promise<R2Metadata> {
  const bucket = env.DANJION_STORAGE;
  if (!bucket) throw new Error('R2 storage binding is not configured');
  const customMetadata = { ...metadata, originalFileName: file.name };
  await bucket.put(r2Key(kind, fileId), file, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata
  });
  return (await r2Head(env, kind, fileId))!;
}

export async function r2Get(env: R2StorageEnv, kind: string, fileId: string): Promise<R2ObjectBody | null> {
  const bucket = env.DANJION_STORAGE;
  if (!bucket) throw new Error('R2 storage binding is not configured');
  return bucket.get(r2Key(kind, fileId));
}

export async function r2Delete(env: R2StorageEnv, kind: string, fileId: string): Promise<void> {
  const bucket = env.DANJION_STORAGE;
  if (!bucket) throw new Error('R2 storage binding is not configured');
  await bucket.delete(r2Key(kind, fileId));
}
