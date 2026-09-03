import { authenticatedFetch } from './auth-fetch';

export type ResidentNewsPost = {
  id: string;
  title: string;
  body: string;
  publishedAt: string | null;
  createdAt: string | null;
};

export type ResidentNewsSubmissionStatus = 'submitted' | 'reviewing' | 'approved' | 'rejected' | string;

export type ResidentNewsSubmission = {
  id: string;
  title: string;
  status: ResidentNewsSubmissionStatus;
  publishedPostId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

type ApiEnvelope<T> = { data: T; requestId: string };

const mockPosts: ResidentNewsPost[] = [{
  id: '70000000-0000-4000-8000-000000000901',
  title: '입주민 확인을 거쳐 게시된 주민소식입니다',
  body: '주민이 제보한 내용은 운영 확인 후 주민전용 소식으로 별도 게시됩니다.',
  publishedAt: '2026-09-03T00:00:00.000Z',
  createdAt: '2026-09-03T00:00:00.000Z'
}];
let mockSubmissions: ResidentNewsSubmission[] = [];

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function mapPost(raw: unknown): ResidentNewsPost {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    body: String(value.body ?? ''),
    publishedAt: nullableString(value.publishedAt),
    createdAt: nullableString(value.createdAt)
  };
}

function mapSubmission(raw: unknown): ResidentNewsSubmission {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    status: String(value.status ?? 'submitted'),
    publishedPostId: nullableString(value.publishedPostId),
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt)
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Resident news API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function complexPath(suffix = ''): string {
  return `/api/v1/complexes/${encodeURIComponent(COMPLEX_SLUG)}/resident-news${suffix}`;
}

export const residentNewsClient = {
  async listPosts(): Promise<ResidentNewsPost[]> {
    if (!API_MODE) return structuredClone(mockPosts);
    const data = await request<{ posts: unknown[] }>(complexPath());
    return Array.isArray(data.posts) ? data.posts.map(mapPost) : [];
  },

  async getPost(postId: string): Promise<ResidentNewsPost> {
    if (!API_MODE) {
      const found = mockPosts.find((post) => post.id === postId);
      if (!found) throw new Error('주민소식을 찾을 수 없습니다.');
      return structuredClone(found);
    }
    return mapPost(await request<unknown>(complexPath(`/${encodeURIComponent(postId)}`)));
  },

  async createSubmission(input: { title: string; body: string }): Promise<ResidentNewsSubmission> {
    if (!API_MODE) {
      const now = new Date().toISOString();
      const created: ResidentNewsSubmission = {
        id: `60000000-0000-4000-8000-${String(mockSubmissions.length + 1).padStart(12, '0')}`,
        title: input.title.trim(),
        status: 'submitted',
        publishedPostId: null,
        createdAt: now,
        updatedAt: now
      };
      mockSubmissions = [created, ...mockSubmissions];
      return structuredClone(created);
    }
    return mapSubmission(await request<unknown>(complexPath('/submissions'), {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body })
    }));
  },

  async listOwnSubmissions(): Promise<ResidentNewsSubmission[]> {
    if (!API_MODE) return structuredClone(mockSubmissions);
    const data = await request<{ submissions: unknown[] }>(`/api/v1/me/resident-news/submissions?complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`);
    return Array.isArray(data.submissions) ? data.submissions.map(mapSubmission) : [];
  }
};
