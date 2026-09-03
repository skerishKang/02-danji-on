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

export type ResidentNewsSubmissionInput = {
  title: string;
  body: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

let mockPosts: ResidentNewsPost[] = [
  {
    id: '00000000-0000-4000-8000-000000000281',
    title: '우리 단지 산책길 정비 소식',
    body: '주민 제보를 운영 확인한 뒤 게시한 주민소식 예시입니다.',
    publishedAt: '2026-09-02T09:00:00.000Z',
    createdAt: '2026-09-02T09:00:00.000Z'
  }
];

let mockSubmissions: ResidentNewsSubmission[] = [
  {
    id: '00000000-0000-4000-8000-000000000282',
    title: '공용 자전거 거치대 제보',
    status: 'reviewing',
    publishedPostId: null,
    createdAt: '2026-09-02T08:00:00.000Z',
    updatedAt: '2026-09-02T08:30:00.000Z'
  }
];

type ApiEnvelope<T> = { data: T; requestId: string };
type ErrorEnvelope = { error?: { message?: string } };

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function mapPost(raw: unknown): ResidentNewsPost {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    body: String(value.body ?? ''),
    publishedAt: nullableText(value.publishedAt),
    createdAt: nullableText(value.createdAt)
  };
}

function mapSubmission(raw: unknown): ResidentNewsSubmission {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    status: String(value.status ?? ''),
    publishedPostId: nullableText(value.publishedPostId),
    createdAt: nullableText(value.createdAt),
    updatedAt: nullableText(value.updatedAt)
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

  let payload: ApiEnvelope<T> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // Preserve the controlled HTTP status below if an upstream returns no JSON body.
  }
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Resident news API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function feedPath(): string {
  return `/api/v1/complexes/${encodeURIComponent(COMPLEX_SLUG)}/resident-news`;
}

export const residentNewsClient = {
  async listPosts(): Promise<ResidentNewsPost[]> {
    if (!API_MODE) return structuredClone(mockPosts);
    const data = await request<{ posts?: unknown[] }>(feedPath());
    return Array.isArray(data.posts) ? data.posts.map(mapPost) : [];
  },

  async getPost(postId: string): Promise<ResidentNewsPost> {
    if (!API_MODE) {
      const found = mockPosts.find((item) => item.id === postId);
      if (!found) throw new Error('주민소식을 찾을 수 없습니다.');
      return structuredClone(found);
    }
    return mapPost(await request<unknown>(`${feedPath()}/${encodeURIComponent(postId)}`));
  },

  async submit(input: ResidentNewsSubmissionInput): Promise<ResidentNewsSubmission> {
    const normalized = { title: input.title.trim(), body: input.body.trim() };
    if (!normalized.title || normalized.title.length > 160) throw new Error('제목은 1~160자로 입력해 주세요.');
    if (!normalized.body || normalized.body.length > 10000) throw new Error('내용은 1~10000자로 입력해 주세요.');

    if (!API_MODE) {
      const now = new Date().toISOString();
      const created: ResidentNewsSubmission = {
        id: crypto.randomUUID(),
        title: normalized.title,
        status: 'submitted',
        publishedPostId: null,
        createdAt: now,
        updatedAt: now
      };
      mockSubmissions = [created, ...mockSubmissions];
      return structuredClone(created);
    }

    return mapSubmission(await request<unknown>(`${feedPath()}/submissions`, {
      method: 'POST',
      body: JSON.stringify(normalized)
    }));
  },

  async listOwnSubmissions(): Promise<ResidentNewsSubmission[]> {
    if (!API_MODE) return structuredClone(mockSubmissions);
    const data = await request<{ submissions?: unknown[] }>(
      `/api/v1/me/resident-news/submissions?complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`
    );
    return Array.isArray(data.submissions) ? data.submissions.map(mapSubmission) : [];
  }
};
