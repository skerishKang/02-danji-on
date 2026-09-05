import { mockPosts } from './data/mock';
import type { ComplexNewsChannel, ComplexPost } from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

type ApiEnvelope<T> = { data: T; requestId?: string };
type ErrorEnvelope = { error?: { message?: string } };

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function mapPost(raw: unknown): ComplexPost {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    sourceName: String(value.source_name ?? value.sourceName ?? ''),
    category: String(value.category ?? ''),
    channel: String(value.channel ?? 'apartment_news') as ComplexNewsChannel,
    title: String(value.title ?? ''),
    body: String(value.body ?? ''),
    publishedAt: String(value.published_at ?? value.publishedAt ?? '')
  };
}

async function publicRequest<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'omit'
  });
  let payload: ApiEnvelope<T> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // Preserve the controlled HTTP error below when a gateway returns no JSON body.
  }
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Public complex news request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function basePath(): string {
  return `/api/v1/complexes/${encodeURIComponent(COMPLEX_SLUG)}/posts`;
}

export const publicComplexNewsClient = {
  async listPosts(filter?: { channel?: ComplexNewsChannel }): Promise<ComplexPost[]> {
    if (!API_MODE) {
      const rows = structuredClone(mockPosts);
      return filter?.channel ? rows.filter((post) => post.channel === filter.channel) : rows;
    }
    const query = filter?.channel ? `?channel=${encodeURIComponent(filter.channel)}` : '';
    const rows = await publicRequest<unknown[]>(`${basePath()}${query}`);
    return Array.isArray(rows) ? rows.map(mapPost) : [];
  },

  async getPost(postId: string): Promise<ComplexPost> {
    if (!API_MODE) {
      const post = mockPosts.find((item) => item.id === postId);
      if (!post) throw new Error('공식소식을 찾을 수 없습니다.');
      return structuredClone(post);
    }
    return mapPost(await publicRequest<unknown>(`${basePath()}/${encodeURIComponent(postId)}`));
  }
};
