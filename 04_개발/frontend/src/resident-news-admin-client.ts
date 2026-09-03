import { authenticatedFetch } from './auth-fetch';
import {
  listMockResidentNewsReviewQueue,
  reviewMockResidentNewsSubmission,
  type MockResidentNewsReviewInput,
  type MockResidentNewsStatus
} from './mock-resident-news-store';

export type ResidentNewsReviewStatus = MockResidentNewsStatus;
export type ResidentNewsReviewAction = MockResidentNewsReviewInput['action'];

export type AdminResidentNewsSubmission = {
  id: string;
  title: string;
  body: string;
  status: ResidentNewsReviewStatus;
  reviewNote: string | null;
  submitterNickname: string;
  publishedPostId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ResidentNewsReviewInput = MockResidentNewsReviewInput;

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

type ApiEnvelope<T> = { data: T; requestId: string };
type ErrorEnvelope = { error?: { message?: string } };

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function mapSubmission(raw: unknown): AdminResidentNewsSubmission {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    title: String(value.title ?? ''),
    body: String(value.body ?? ''),
    status: String(value.status ?? 'submitted') as ResidentNewsReviewStatus,
    reviewNote: nullableText(value.reviewNote),
    submitterNickname: String(value.submitterNickname ?? '입주민'),
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
  }, 'admin');

  let payload: ApiEnvelope<T> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // Preserve the controlled HTTP status below if an upstream returns no JSON body.
  }
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Resident-news operator API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function queuePath(): string {
  return `/api/v1/operator/complexes/${encodeURIComponent(COMPLEX_SLUG)}/resident-news/submissions`;
}

export const residentNewsAdminClient = {
  async list(status: ResidentNewsReviewStatus): Promise<AdminResidentNewsSubmission[]> {
    if (!API_MODE) return listMockResidentNewsReviewQueue(status).map(mapSubmission);
    const data = await request<{ submissions?: unknown[] }>(`${queuePath()}?status=${encodeURIComponent(status)}`);
    return Array.isArray(data.submissions) ? data.submissions.map(mapSubmission) : [];
  },

  async review(submissionId: string, input: ResidentNewsReviewInput): Promise<AdminResidentNewsSubmission | { id: string; status: ResidentNewsReviewStatus; publishedPostId?: string | null }> {
    if (!API_MODE) return mapSubmission(reviewMockResidentNewsSubmission(submissionId, input));
    return request<AdminResidentNewsSubmission | { id: string; status: ResidentNewsReviewStatus; publishedPostId?: string | null }>(
      `${queuePath()}/${encodeURIComponent(submissionId)}`,
      { method: 'PATCH', body: JSON.stringify(input) }
    );
  }
};
