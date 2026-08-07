import { authProvider } from './auth';
import { mockBusinesses } from './data/mock';
import { listMockReviewEvents } from './mock-audit-store';
import { createStoredMockBenefit, createStoredMockPost } from './mock-content-store';
import { listApprovedMockBusinesses, listMockApplications, reviewMockApplication, type MockApplicationRecord } from './mock-store';

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

export interface AdminReviewEvent {
  id: string;
  applicationId: string;
  businessName: string;
  actorType: 'applicant' | 'manager' | 'system';
  actorName: string;
  fromStatus: AdminApplicationStatus | null;
  toStatus: AdminApplicationStatus;
  reviewNote?: string | null;
  createdAt: string;
}

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authProvider.headers('admin'),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Admin API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function fromMockApplication(record: MockApplicationRecord): AdminApplication {
  return {
    id: record.id,
    relationType: record.relationType,
    businessName: record.businessName,
    categoryName: record.categoryName,
    serviceSummary: record.serviceSummary,
    priceText: record.priceText,
    contactMethod: record.contactMethod,
    serviceArea: record.serviceArea,
    benefitText: record.benefitText,
    availabilityText: record.availabilityText,
    status: record.status,
    reviewNote: record.reviewNote,
    approvedBusinessId: record.approvedBusinessId,
    applicantName: record.applicantName,
    createdAt: record.createdAt
  };
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

function mapReviewEvent(raw: Record<string, unknown>): AdminReviewEvent {
  return {
    id: String(raw.id),
    applicationId: String(raw.application_id ?? ''),
    businessName: String(raw.business_name ?? ''),
    actorType: String(raw.actor_type ?? 'system') as AdminReviewEvent['actorType'],
    actorName: String(raw.actor_name ?? '사용자'),
    fromStatus: raw.from_status ? String(raw.from_status) as AdminApplicationStatus : null,
    toStatus: String(raw.to_status ?? 'pending') as AdminApplicationStatus,
    reviewNote: raw.review_note ? String(raw.review_note) : null,
    createdAt: String(raw.created_at ?? '')
  };
}

class MockAdminAdapter {
  async listApplications(status = 'all') {
    return listMockApplications(status as AdminApplicationStatus | 'all').map(fromMockApplication);
  }

  async reviewApplication(id: string, status: Exclude<AdminApplicationStatus, 'draft'>, reviewNote: string) {
    if (status === 'pending') throw new Error('검토 결과는 보완 요청, 승인, 반려 중 하나여야 합니다.');
    return fromMockApplication(reviewMockApplication(id, status, reviewNote));
  }

  async listReviewEvents(applicationId?: string | null): Promise<AdminReviewEvent[]> {
    return listMockReviewEvents(applicationId).map((event) => ({ ...event }));
  }

  async listBusinesses(): Promise<AdminBusiness[]> {
    return [...mockBusinesses, ...listApprovedMockBusinesses()].map(({ id, name }) => ({ id, name }));
  }

  async createPost(input: { sourceName: string; category: string; title: string; body: string }) {
    return createStoredMockPost(input);
  }

  async createBenefit(input: { businessId: string; title: string; description: string; conditions?: string }) {
    const business = [...mockBusinesses, ...listApprovedMockBusinesses()].find((item) => item.id === input.businessId);
    if (!business) throw new Error('혜택 대상 가게를 찾을 수 없습니다.');
    return createStoredMockBenefit({ ...input, businessName: business.name });
  }
}

class ApiAdminAdapter {
  async listApplications(status = 'all'): Promise<AdminApplication[]> {
    const query = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
    const rows = await apiRequest<Record<string, unknown>[]>(`/api/v1/admin/complexes/${COMPLEX_SLUG}/business-applications${query}`);
    return rows.map(mapApplication);
  }

  async reviewApplication(id: string, status: Exclude<AdminApplicationStatus, 'draft'>, reviewNote: string) {
    if (status === 'pending') throw new Error('검토 결과는 보완 요청, 승인, 반려 중 하나여야 합니다.');
    return apiRequest<Record<string, unknown>>(`/api/v1/admin/business-applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reviewNote })
    });
  }

  async listReviewEvents(applicationId?: string | null): Promise<AdminReviewEvent[]> {
    const params = new URLSearchParams();
    if (applicationId) params.set('applicationId', applicationId);
    params.set('limit', '200');
    const rows = await apiRequest<Record<string, unknown>[]>(`/api/v1/admin/complexes/${COMPLEX_SLUG}/application-review-events?${params.toString()}`);
    return rows.map(mapReviewEvent);
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
