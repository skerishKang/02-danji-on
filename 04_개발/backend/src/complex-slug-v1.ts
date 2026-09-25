const COMPLEX_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function decodeComplexSlug(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    return COMPLEX_SLUG.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
