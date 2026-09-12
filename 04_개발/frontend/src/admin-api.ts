import { authenticatedFetch } from './auth-fetch';
import { mockBusinesses } from './data/mock';
import { listMockReviewEvents } from './mock-audit-store';
import { createStoredMockBenefit, createStoredMockPost } from './mock-content-store';
import { listApprovedMockBusinesses, listMockApplications, reviewMockApplication, type MockApplicationRecord } from './mock-store';
import { listMockRecommendations, reviewMockRecommendation } from './mock-recommendation-store';

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

// Report R-B reviewer authority (#308 backend, #315 UI). Approval is decided
// ONLY by resolved_category_id + resolved_relation_type. Legacy category_name /
// relation_type are history display and never gate or mutate approval.
export type AdminRecommendationStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';
export type AdminRecommendationReviewStatus = Exclude<AdminRecommendationStatus, 'pending'>;

export interface AdminRecommendation {
  id: string;
  businessName: string;
  serviceSummary: string;
  serviceArea: string | null;
  reporterNote: string | null;
  reportedRelationRaw: string | null;
  relationDetail: string | null;
  reportPrice: string | null;
  reportHours: string | null;
  categoryName: string | null;
  relationType: string | null;
  resolvedCategoryId: string | null;
  resolvedRelationType: string | null;
  status: AdminRecommendationStatus;
  reviewNote: string | null;
  approvedBusinessId: string | null;
  reporterNickname: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecommendationReviewResult {
  id: string;
  status: AdminRecommendationStatus;
  reviewNote?: string | null;
  approvedBusinessId?: string | null;
  alreadyApproved?: boolean;
  categoryUnresolved?: string;
}

export function canReviewRecommendation(status: AdminRecommendationStatus) {
  return status === 'pending' || status === 'changes_requested';
}

export function recommendationApprovalBlockReason(
  recommendation: Pick<AdminRecommendation, 'status' | 'resolvedCategoryId' | 'resolvedRelationType'>
): string | null {
  if (!canReviewRecommendation(recommendation.status)) return '현재 상태에서는 검토할 수 없습니다.';
  if (!recommendation.resolvedCategoryId) return '카테고리가 아직 확정되지 않아 승인할 수 없습니다.';
  if (!recommendation.resolvedRelationType) return '관계가 아직 확정되지 않아 승인할 수 없습니다.';
  return null;
}

// #412: role-aware admin console. The single source of truth for admin
// authority is the fixed GET /api/v1/admin/authority grant resolved by the
// backend (#411) from scope/wildcard operator grants. The client NEVER infers
// a role from email, browser storage, query params, or request headers.
export type AdminAuthorityLevel = 'admin' | 'operator';

export interface AdminAuthority {
  level: AdminAuthorityLevel;
  label: '최고관리자' | '일반관리자';
  scopes: string[];
  wildcard: boolean;
}

const SUPER_ADMIN_LABEL = '최고관리자';
const OPERATOR_LABEL = '일반관리자';

// Fail-closed normalization. A 최고관리자 grant is valid ONLY when BOTH the
// admin level and the wildcard flag agree. Every other combination — admin
// without wildcard, wildcard without admin, or any malformed/missing field —
// collapses to the least-privileged operator view with wildcard forced false,
// so a partial or inconsistent grant can never widen privileged access.
export function normalizeAdminAuthority(raw: unknown): AdminAuthority {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const superAdmin = record.level === 'admin' && record.wildcard === true;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  return {
    level: superAdmin ? 'admin' : 'operator',
    label: superAdmin ? SUPER_ADMIN_LABEL : OPERATOR_LABEL,
    scopes,
    wildcard: superAdmin
  };
}

export function hasSuperAdminCapability(authority: AdminAuthority | null): boolean {
  if (!authority) return false;
  return authority.level === 'admin' && authority.wildcard === true;
}

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  }, 'admin');
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

function mapRecommendation(raw: Record<string, unknown>): AdminRecommendation {
  return {
    id: String(raw.id),
    businessName: String(raw.businessName ?? ''),
    serviceSummary: String(raw.serviceSummary ?? ''),
    serviceArea: raw.serviceArea ? String(raw.serviceArea) : null,
    reporterNote: raw.reporterNote ? String(raw.reporterNote) : null,
    reportedRelationRaw: raw.reportedRelationRaw ? String(raw.reportedRelationRaw) : null,
    relationDetail: raw.relationDetail ? String(raw.relationDetail) : null,
    reportPrice: raw.reportPrice ? String(raw.reportPrice) : null,
    reportHours: raw.reportHours ? String(raw.reportHours) : null,
    categoryName: raw.categoryName ? String(raw.categoryName) : null,
    relationType: raw.relationType ? String(raw.relationType) : null,
    resolvedCategoryId: raw.resolvedCategoryId ? String(raw.resolvedCategoryId) : null,
    resolvedRelationType: raw.resolvedRelationType ? String(raw.resolvedRelationType) : null,
    status: String(raw.status ?? 'pending') as AdminRecommendationStatus,
    reviewNote: raw.reviewNote ? String(raw.reviewNote) : null,
    approvedBusinessId: raw.approvedBusinessId ? String(raw.approvedBusinessId) : null,
    reporterNickname: String(raw.reporterNickname ?? '제보자'),
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? '')
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

  async listRecommendations(status: AdminRecommendationStatus = 'pending'): Promise<AdminRecommendation[]> {
    return listMockRecommendations(status);
  }

  async reviewRecommendation(id: string, status: AdminRecommendationReviewStatus, reviewNote: string): Promise<RecommendationReviewResult> {
    return reviewMockRecommendation(id, status, reviewNote);
  }

  async createPost(input: { sourceName: string; category: string; title: string; body: string }) {
    return createStoredMockPost(input);
  }

  async createBenefit(input: { businessId: string; title: string; description: string; conditions?: string }) {
    const business = [...mockBusinesses, ...listApprovedMockBusinesses()].find((item) => item.id === input.businessId);
    if (!business) throw new Error('혜택 대상 가게를 찾을 수 없습니다.');
    return createStoredMockBenefit({ ...input, businessName: business.name });
  }

  async fetchAuthority(): Promise<AdminAuthority> {
    // Preview/mock carries no real grant, so it stays at least privilege.
    return normalizeAdminAuthority({ level: 'operator', label: OPERATOR_LABEL, scopes: [], wildcard: false });
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

  async listRecommendations(status: AdminRecommendationStatus = 'pending'): Promise<AdminRecommendation[]> {
    const data = await apiRequest<{ recommendations?: Record<string, unknown>[] }>(
      `/api/v1/admin/complexes/${COMPLEX_SLUG}/shop-recommendations?status=${encodeURIComponent(status)}`
    );
    return (data.recommendations ?? []).map(mapRecommendation);
  }

  async reviewRecommendation(id: string, status: AdminRecommendationReviewStatus, reviewNote: string): Promise<RecommendationReviewResult> {
    return apiRequest<RecommendationReviewResult>(`/api/v1/admin/shop-recommendations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reviewNote })
    });
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

  async fetchAuthority(): Promise<AdminAuthority> {
    return normalizeAdminAuthority(await apiRequest<unknown>('/api/v1/admin/authority'));
  }
}

export const adminAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdminAdapter()
  : new MockAdminAdapter();