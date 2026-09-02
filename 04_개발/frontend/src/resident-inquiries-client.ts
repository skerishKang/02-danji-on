import { authenticatedFetch } from './auth-fetch';

export type ResidentInquiryStatus = 'received' | 'in_progress' | 'answered' | 'closed';
export type ResidentInquirySummary = {
  id: string;
  inquiryType: string;
  title: string;
  status: ResidentInquiryStatus;
  answeredAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ResidentInquiryDetail = ResidentInquirySummary & {
  body: string;
  response: string | null;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

type ApiEnvelope<T> = { data: T; requestId?: string };
let mockInquiries: ResidentInquiryDetail[] = [{
  id: '00000000-0000-4000-8000-000000000301',
  inquiryType: '생활문의',
  title: '공용시설 이용 문의',
  body: '공용시설 이용시간을 확인하고 싶습니다.',
  status: 'answered',
  response: '관리사무소 안내시간을 확인해 주세요.',
  answeredAt: '2026-09-02T09:00:00.000Z',
  closedAt: null,
  createdAt: '2026-09-02T08:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z'
}];

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}
function mapSummary(raw: unknown): ResidentInquirySummary {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    inquiryType: String(value.inquiryType ?? ''),
    title: String(value.title ?? ''),
    status: String(value.status ?? 'received') as ResidentInquiryStatus,
    answeredAt: value.answeredAt == null ? null : String(value.answeredAt),
    closedAt: value.closedAt == null ? null : String(value.closedAt),
    createdAt: String(value.createdAt ?? ''),
    updatedAt: String(value.updatedAt ?? '')
  };
}
function mapDetail(raw: unknown): ResidentInquiryDetail {
  const value = row(raw);
  return {
    ...mapSummary(value),
    body: String(value.body ?? ''),
    response: value.response == null ? null : String(value.response)
  };
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Inquiry API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}
function listPath(): string {
  return `/api/v1/me/inquiries?complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`;
}

export const residentInquiriesClient = {
  async list(): Promise<ResidentInquirySummary[]> {
    if (!API_MODE) return structuredClone(mockInquiries.map(({ body: _body, response: _response, ...item }) => item));
    const data = row(await request<unknown>(listPath()));
    return Array.isArray(data.inquiries) ? data.inquiries.map(mapSummary) : [];
  },

  async create(input: { inquiryType: string; title: string; body: string }): Promise<ResidentInquiryDetail> {
    const inquiryType = input.inquiryType.trim();
    const title = input.title.trim();
    const body = input.body.trim();
    if (!inquiryType || inquiryType.length > 64 || !title || title.length > 160 || !body || body.length > 10000) {
      throw new Error('문의 유형 1~64자, 제목 1~160자, 내용 1~10000자를 입력해 주세요.');
    }
    if (!API_MODE) {
      const now = new Date().toISOString();
      const item: ResidentInquiryDetail = {
        id: crypto.randomUUID(), inquiryType, title, body, status: 'received', response: null,
        answeredAt: null, closedAt: null, createdAt: now, updatedAt: now
      };
      mockInquiries = [item, ...mockInquiries];
      return structuredClone(item);
    }
    return mapDetail(await request<unknown>('/api/v1/me/inquiries', {
      method: 'POST',
      body: JSON.stringify({ complexSlug: COMPLEX_SLUG, inquiryType, title, body })
    }));
  },

  async get(inquiryId: string): Promise<ResidentInquiryDetail> {
    if (!API_MODE) {
      const item = mockInquiries.find((row) => row.id === inquiryId);
      if (!item) throw new Error('문의를 찾을 수 없습니다.');
      return structuredClone(item);
    }
    return mapDetail(await request<unknown>(`/api/v1/me/inquiries/${encodeURIComponent(inquiryId)}`));
  },

  async close(inquiryId: string): Promise<ResidentInquiryDetail> {
    if (!API_MODE) {
      const item = mockInquiries.find((row) => row.id === inquiryId);
      if (!item || item.status !== 'answered') throw new Error('답변 완료된 문의만 닫을 수 있습니다.');
      const now = new Date().toISOString();
      const closed = { ...item, status: 'closed' as const, closedAt: now, updatedAt: now };
      mockInquiries = mockInquiries.map((row) => row.id === inquiryId ? closed : row);
      return structuredClone(closed);
    }
    return mapDetail(await request<unknown>(`/api/v1/me/inquiries/${encodeURIComponent(inquiryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'closed' })
    }));
  }
};
