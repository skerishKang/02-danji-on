import { authenticatedFetch } from './auth-fetch';

export type ResidentReportReason = 'abuse' | 'threat' | 'privacy' | 'defamation_risk' | 'spam' | 'other';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

const mockBlocked = new Set<string>();
const mockReports = new Set<string>();

type ApiEnvelope<T> = { data: T; requestId: string };

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
    throw new Error(message || `Resident safety API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function query(): string {
  return `complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`;
}

export const residentSafetyClient = {
  async blockResident(userId: string): Promise<void> {
    if (!API_MODE) {
      mockBlocked.add(userId);
      return;
    }
    await request(`/api/v1/me/blocks?${query()}`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
  },

  async reportResident(userId: string, reason: ResidentReportReason, detail?: string): Promise<'submitted' | 'already_reported' | string> {
    if (!API_MODE) {
      const key = `resident:${userId}`;
      if (mockReports.has(key)) return 'already_reported';
      mockReports.add(key);
      return 'submitted';
    }
    const data = await request<Record<string, unknown>>(`/api/v1/me/reports?${query()}`, {
      method: 'POST',
      body: JSON.stringify({ targetType: 'resident', targetId: userId, reason, detail: detail?.trim() || undefined })
    });
    return String(data.status ?? 'submitted');
  },

  async reportMessage(messageId: string, reason: ResidentReportReason, detail?: string): Promise<'submitted' | 'already_reported' | string> {
    if (!API_MODE) {
      const key = `message:${messageId}`;
      if (mockReports.has(key)) return 'already_reported';
      mockReports.add(key);
      return 'submitted';
    }
    const data = await request<Record<string, unknown>>(`/api/v1/me/reports?${query()}`, {
      method: 'POST',
      body: JSON.stringify({ targetType: 'message', targetId: messageId, reason, detail: detail?.trim() || undefined })
    });
    return String(data.status ?? 'submitted');
  }
};
