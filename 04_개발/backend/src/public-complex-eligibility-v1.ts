export const PUBLIC_COMPLEX_STATUSES = ['active', 'pilot'] as const;

export function isPublicComplexStatus(status: unknown): boolean {
  return typeof status === 'string' && (PUBLIC_COMPLEX_STATUSES as readonly string[]).includes(status);
}
