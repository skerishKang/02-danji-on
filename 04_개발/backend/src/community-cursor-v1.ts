const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_CHARS = 512;

export const COMMUNITY_FEED_SORT = 'published_at:desc,created_at:desc,id:desc';
export const COMMUNITY_COMMENT_SORT = 'created_at:asc,id:asc';
export const COMMUNITY_REPLY_SORT = 'created_at:asc,id:asc';

export type CommunityCursorSort =
  | typeof COMMUNITY_FEED_SORT
  | typeof COMMUNITY_COMMENT_SORT
  | typeof COMMUNITY_REPLY_SORT;

export interface CommunityCursorPosition {
  keys: string[];
}

interface CommunityCursorEnvelope {
  v: 1;
  scope: string;
  sort: CommunityCursorSort;
  keys: string[];
}

function canonicalTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cursorKeyCount(sort: CommunityCursorSort): number {
  return sort === COMMUNITY_FEED_SORT ? 3 : 2;
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  return atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
}

export function encodeCommunityCursor(
  scope: string,
  sort: CommunityCursorSort,
  rawKeys: unknown[]
): string | null {
  if (!scope || scope.length > 256) return null;
  if (rawKeys.length !== cursorKeyCount(sort)) return null;
  const keys: string[] = [];
  for (let index = 0; index < rawKeys.length - 1; index += 1) {
    const timestamp = canonicalTimestamp(rawKeys[index]);
    if (!timestamp) return null;
    keys.push(timestamp);
  }
  const id = String(rawKeys[rawKeys.length - 1] || '').toLowerCase();
  if (!UUID_RE.test(id)) return null;
  keys.push(id);
  return base64UrlEncode(JSON.stringify({ v: 1, scope, sort, keys } satisfies CommunityCursorEnvelope));
}

export function decodeCommunityCursor(
  raw: string | null,
  expectedScope: string,
  expectedSort: CommunityCursorSort
): CommunityCursorPosition | null {
  if (raw === null) return null;
  if (!raw || raw.length > MAX_CURSOR_CHARS || !BASE64URL_RE.test(raw)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(raw)) as Partial<CommunityCursorEnvelope>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (Object.keys(parsed).sort().join(',') !== 'keys,scope,sort,v') return null;
    if (parsed.v !== 1 || parsed.scope !== expectedScope || parsed.sort !== expectedSort) return null;
    if (!Array.isArray(parsed.keys) || parsed.keys.length !== cursorKeyCount(expectedSort)) return null;
    if (parsed.keys.some((key) => typeof key !== 'string')) return null;

    const keys = [...parsed.keys];
    for (let index = 0; index < keys.length - 1; index += 1) {
      if (canonicalTimestamp(keys[index]) !== keys[index]) return null;
    }
    const id = keys[keys.length - 1].toLowerCase();
    if (!UUID_RE.test(id) || id !== keys[keys.length - 1]) return null;
    keys[keys.length - 1] = id;
    return { keys };
  } catch {
    return null;
  }
}

export function buildCommunityPage<T>(
  rows: T[],
  limit: number,
  scope: string,
  sort: CommunityCursorSort,
  keysForRow: (row: T) => unknown[]
): { rows: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const nextCursor = hasMore
    ? encodeCommunityCursor(scope, sort, keysForRow(pageRows[pageRows.length - 1]))
    : null;
  if (hasMore && !nextCursor) throw new Error('Community cursor could not be issued');
  return { rows: pageRows, nextCursor, hasMore };
}
