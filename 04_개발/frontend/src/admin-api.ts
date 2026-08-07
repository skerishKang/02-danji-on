import { mockBusinesses } from './data/mock';

export type AdminApplicationStatus = 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected';

export interface AdminApplication {
  id: string;
  relationType: string;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  priceText?: string;
  contactMethod?: string;
  serviceArea?: string;
  benefitText?: string;
  availabilityText?: string;
  status: AdminApplicationStatus;
  reviewNote?: string | null;
  approvedBusinessId?: string | null;
  applicantName: string;
  createdAt: string;
}

export interface AdminBusiness {
  id: string;
  name: string;
}

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function adminHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (import.meta.env.DEV) {
    const subject = import.meta.env.VITE_DEV_ADMIN_AUTH_USER || import.meta.env.VITE_DEV_AUTH_USER;
    if (subject) headers['x-danjion-dev-auth-user'] = subject;
  }
  return headers;
}

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...adminHeaders(), ...(init?.headers || {}) }
  });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Admin API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function mapApplication(raw: Record<string, unknown>): AdminApplication {
  return {
    id: String(raw.id),
    relationType: String(raw.relation_type ?? 'resident'),
    businessName: String(raw.business_name ?? ''),
    categoryName: String(raw.category_name ?? ''),
    serviceSummary: String(raw.service_summary ?? ''),
    priceText: raw.price_text ? String(raw.price_text) : undefined,
    contactMethod: raw.contact_method ? String(raw.contact_method) : undefined,
    serviceArea: raw.service_area ? String(raw.service_area) : undefined,
    benefitText: raw.benefit_text ? String(raw.benefit_text) : undefined,
    availabilityText: raw.availability_text ? String(raw.availability_text) : undefined,
    status: String(raw.status ?? 'pending') as AdminApplicationStatus,
    reviewNote: raw.review_note ? String(raw.review_note) : null,
    approvedBusinessId: raw.approved_business_id ? String(raw.approved_business_id) : null,
    applicantName: String(raw.applicant_name ?? '신청자'),
    createdAt: String(raw.created_at ?? '')
  };
}

class MockAdminAdapter {
  private applications: AdminApplication[] = [
    { id: 'mock-admin-1', relationType: 'resident', businessName: '정성 홈베이킹', categoryName: '음식점·반찬·카페', serviceSummary: '주문형 수제 쿠키와 답례품', priceText: '상담 후 안내', benefitText: '첫 주문 10% 할인', status: 'pending', applicantName: '온이웃', createdAt: '2026-08-07T09:00:00+09:00' },
    { id: 'mock-admin-2', relationType: 'resident_family', businessName: '맑은창 방충망 수리', categoryName: '청소·수리·에어컨 서비스', serviceSummary: '방충망 교체와 생활 수리', status: 'changes_requested', reviewNote: '서비스 가능 지역을 구체적으로 적어주세요.', applicantName: '온이웃', createdAt: '2026-08-06T09:00:00+09:00' },
    { id: 'mock-admin-3', relationType: 'neighbor', businessName: '이웃 영어회화', categoryName: '과외·수업', serviceSummary: '영어회화 소규모 수업', status: 'pending', applicantName: '테스트 신청자', createdAt: '2026-08-05T09:00:00+09:00' }
  ];

  async listApplications(status = 'all') {
    return status === 'all' ? [...this.applications] : this.applications.filter((item) => item.status === status);
  }

  async reviewApplication(id: string, status: Exclude<AdminApplicationStatus, 'draft'>, reviewNote: string) {
    const target = this.applications.find((item) => item.id === id);
    if (!target) throw new Error('신청을 찾을 수 없습니다.');
    if (!['pending', 'changes_requested'].includes(target.status)) throw new Error('현재 상태에서는 검토할 수 없습니다.');
    target.status = status;
    target.reviewNote = reviewNote || null;
    if (status === 'approved') target.approvedBusinessId = target.approvedBusinessId || `mock-business-${id}`;
    return { ...target };
  }

  async listBusinesses(): Promise<AdminBusiness[]> {
    return mockBusinesses.map(({ id, name }) => ({ id, name }));
  }

  async createPost(input: { sourceName: string; category: string; title: string; body: string }) {
    return { id: `mock-post-${Date.now()}`, ...input, status: 'published' };
  }

  async createBenefit(input: { businessId: string; title: string; description: string; conditions?: string }) {
    return { id: `mock-benefit-${Date.now()}`, ...input, status: 'active' };
  }
}

class ApiAdminAdapter {
  async listApplications(status = 'all'): Promise<AdminApplication[]> {
    const query = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
    const rows = await apiRequest<Record<string, unknown>[]>(`/api/v1/admin/complexes/${COMPLEX_SLUG}/business-applications${query}`);
    return rows.map(mapApplication);
  }

  async reviewApplication(id: string, status: Exclude<AdminApplicationStatus, 'draft'>, reviewNote: string) {
    return apiRequest<Record<string, unknown>>(`/api/v1/admin/business-applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reviewNote })
    });
  }

  async listBusinesses(): Promise<AdminBusiness[]> {
    const rows = await apiRequest<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses`);
    return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? '') }));
  }

  async createPost(input: { sourceName: string; category: string; title: string; body: string }) {
    return apiRequest<Record<string, unknown>>(`/api/v1/admin/complexes/${COMPLEX_SLUG}/posts`, {
      method: 'POST',
      body: JSON.stringify({ ...input, status: 'published' })
    });
  }

  async createBenefit(input: { businessId: string; title: string; description: string; conditions?: string }) {
    return apiRequest<Record<string, unknown>>(`/api/v1/admin/complexes/${COMPLEX_SLUG}/benefits`, {
      method: 'POST',
      body: JSON.stringify({ ...input, status: 'active' })
    });
  }
}

export const adminAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdminAdapter()
  : new MockAdminAdapter();
