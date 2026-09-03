import { authenticatedFetch } from './auth-fetch';

export type ResidentSummary = {
  postCount: number;
  commentCount: number;
  receivedReactionCount: number;
  savedBusinessCount: number;
  unreadMessageCount: number;
  household: {
    status: string;
    membershipRole: string;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

const MOCK_SUMMARY: ResidentSummary = {
  postCount: 2,
  commentCount: 4,
  receivedReactionCount: 7,
  savedBusinessCount: 3,
  unreadMessageCount: 1,
  household: {
    status: 'verified',
    membershipRole: 'primary'
  }
};

type ApiEnvelope<T> = { data: T; requestId: string };
type ErrorEnvelope = { error?: { message?: string } };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function mapSummary(raw: unknown): ResidentSummary {
  const value = record(raw);
  const household = record(value.household);
  return {
    postCount: count(value.postCount),
    commentCount: count(value.commentCount),
    receivedReactionCount: count(value.receivedReactionCount),
    savedBusinessCount: count(value.savedBusinessCount),
    unreadMessageCount: count(value.unreadMessageCount),
    household: {
      status: String(household.status || ''),
      membershipRole: String(household.membershipRole || '')
    }
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json' }
  }, 'resident');

  let payload: ApiEnvelope<T> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<T> | ErrorEnvelope;
  } catch {
    // Preserve the controlled HTTP status when an upstream returns no JSON body.
  }
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Resident summary API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

export const residentSummaryClient = {
  async getSummary(): Promise<ResidentSummary> {
    if (!API_MODE) return structuredClone(MOCK_SUMMARY);
    const data = await request<unknown>(
      `/api/v1/me/summary?complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`
    );
    return mapSummary(data);
  }
};
