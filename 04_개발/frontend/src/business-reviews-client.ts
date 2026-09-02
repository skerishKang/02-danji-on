import { authenticatedFetch } from './auth-fetch';

export type BusinessReviewReply = {
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessReview = {
  id: string;
  body: string;
  author: { userId: string; nickname: string; avatarUrl: string | null };
  reply: BusinessReviewReply | null;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';
const MOCK_SELF_ID = '00000000-0000-4000-8000-000000000270';

type ApiEnvelope<T> = { data: T; requestId?: string };

const mockReviews = new Map<string, BusinessReview[]>([
  ['food-01', [{
    id: '00000000-0000-4000-8000-000000000291',
    body: '반찬이 깔끔하고 이웃에게 추천하기 좋았습니다.',
    author: { userId: '00000000-0000-4000-8000-000000000272', nickname: '이웃 주민', avatarUrl: null },
    reply: { body: '이용해 주셔서 감사합니다.', createdAt: '2026-09-02T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z' },
    createdAt: '2026-09-02T07:00:00.000Z',
    updatedAt: '2026-09-02T07:00:00.000Z'
  }]]
]);

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function mapReview(raw: unknown): BusinessReview {
  const value = row(raw);
  const author = row(value.author);
  const reply = value.reply ? row(value.reply) : null;
  return {
    id: String(value.id ?? ''),
    body: String(value.body ?? ''),
    author: {
      userId: String(author.userId ?? ''),
      nickname: String(author.nickname ?? ''),
      avatarUrl: typeof author.avatarUrl === 'string' ? author.avatarUrl : null
    },
    reply: reply ? {
      body: String(reply.body ?? ''),
      createdAt: String(reply.createdAt ?? ''),
      updatedAt: String(reply.updatedAt ?? '')
    } : null,
    createdAt: String(value.createdAt ?? ''),
    updatedAt: String(value.updatedAt ?? '')
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
    throw new Error(message || `Business review API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function reviewsPath(businessId: string): string {
  return `/api/v1/complexes/${encodeURIComponent(COMPLEX_SLUG)}/businesses/${encodeURIComponent(businessId)}/reviews`;
}

export const businessReviewsClient = {
  async list(businessId: string): Promise<BusinessReview[]> {
    if (!API_MODE) return structuredClone(mockReviews.get(businessId) ?? []);
    const data = row(await request<unknown>(reviewsPath(businessId)));
    return Array.isArray(data.reviews) ? data.reviews.map(mapReview) : [];
  },

  async create(businessId: string, body: string): Promise<void> {
    const text = body.trim();
    if (!text || text.length > 2000) throw new Error('후기는 1~2000자로 입력해 주세요.');
    if (!API_MODE) {
      const now = new Date().toISOString();
      const next: BusinessReview = {
        id: crypto.randomUUID(),
        body: text,
        author: { userId: MOCK_SELF_ID, nickname: '나의 단지온', avatarUrl: null },
        reply: null,
        createdAt: now,
        updatedAt: now
      };
      mockReviews.set(businessId, [next, ...(mockReviews.get(businessId) ?? [])]);
      return;
    }
    await request(reviewsPath(businessId), { method: 'POST', body: JSON.stringify({ body: text }) });
  },

  async upsertOwnerReply(businessId: string, reviewId: string, body: string): Promise<void> {
    const text = body.trim();
    if (!text || text.length > 2000) throw new Error('답글은 1~2000자로 입력해 주세요.');
    if (!API_MODE) {
      const list = mockReviews.get(businessId) ?? [];
      const now = new Date().toISOString();
      mockReviews.set(businessId, list.map((item) => item.id === reviewId
        ? { ...item, reply: { body: text, createdAt: item.reply?.createdAt ?? now, updatedAt: now } }
        : item));
      return;
    }
    await request(`${reviewsPath(businessId)}/${encodeURIComponent(reviewId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body: text })
    });
  }
};
