import { authenticatedFetch } from './auth-fetch';

export const COMMUNITY_API_MODE = import.meta.env.VITE_DATA_MODE === 'api';
export const COMMUNITY_COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export type CommunityPostKind = 'question' | 'together' | 'resident_story' | 'life_report';
export type CommunityReportReason = 'abuse' | 'threat' | 'privacy' | 'defamation_risk' | 'spam' | 'other';

export interface CommunityPost {
  id: string;
  kind: CommunityPostKind;
  title: string;
  body: string;
  status: string;
  author: { nickname: string };
  reactionCount: number;
  commentCount: number;
  viewerLiked: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CommunityComment {
  id: string;
  postId: string;
  body: string;
  status: string;
  author: { nickname: string };
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export class CommunityApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'CommunityApiError';
    this.status = status;
    this.code = code;
  }
}

type ApiEnvelope<T> = { data: T; requestId?: string };
type ErrorEnvelope = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  }, 'resident');

  let payload: ApiEnvelope<T> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // Keep the controlled status error below when a gateway returns no JSON body.
  }

  if (!response.ok) {
    const error = 'error' in payload ? payload.error : undefined;
    throw new CommunityApiError(
      error?.message || `Community API request failed: ${response.status}`,
      response.status,
      error?.code || null
    );
  }

  return (payload as ApiEnvelope<T>).data;
}

function postPath(suffix = '') {
  return `/api/v1/complexes/${COMMUNITY_COMPLEX_SLUG}/community/posts${suffix}`;
}

export const communityApi = {
  async listPosts(kind?: CommunityPostKind): Promise<CommunityPost[]> {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    params.set('limit', '50');
    return request<CommunityPost[]>(`${postPath()}?${params.toString()}`);
  },

  async createPost(input: { kind: CommunityPostKind; title: string; body: string }): Promise<CommunityPost> {
    return request<CommunityPost>(postPath(), {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  async getPost(postId: string): Promise<CommunityPost> {
    return request<CommunityPost>(postPath(`/${encodeURIComponent(postId)}`));
  },

  async listComments(postId: string): Promise<CommunityComment[]> {
    return request<CommunityComment[]>(postPath(`/${encodeURIComponent(postId)}/comments`));
  },

  async createComment(postId: string, body: string): Promise<CommunityComment> {
    return request<CommunityComment>(postPath(`/${encodeURIComponent(postId)}/comments`), {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  },

  async setLike(postId: string, active: boolean): Promise<{ postId: string; reactionType: 'like'; active: boolean }> {
    return request(postPath(`/${encodeURIComponent(postId)}/reactions`), {
      method: active ? 'POST' : 'DELETE'
    });
  },

  async report(
    targetType: 'post' | 'comment',
    targetId: string,
    reason: CommunityReportReason = 'other',
    detail = ''
  ): Promise<{ id?: string; status: string; createdAt?: string | null }> {
    return request(`/api/v1/complexes/${COMMUNITY_COMPLEX_SLUG}/community/reports`, {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, reason, detail })
    });
  }
};
