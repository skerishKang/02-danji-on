import { authProvider } from '../auth';
import { mockBenefits, mockBusinesses, mockPosts } from '../data/mock';
import { listStoredMockBenefits, listStoredMockPosts } from '../mock-content-store';
import {
  createMockApplication,
  getMockApplicationForSubject,
  listApprovedMockBusinesses,
  listMockApplicationsForSubject,
  resubmitMockApplication,
  type MockApplicationRecord
} from '../mock-store';
import type {
  Benefit,
  Business,
  BusinessApplication,
  BusinessApplicationInput,
  BusinessContact,
  BusinessFilters,
  ComplexPost,
  DataAdapter,
  RelationType
} from '../types';
import { createApplicationIdempotencyKey, retryNetworkOnce } from './idempotency';

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function relationRank(relation: RelationType): number {
  return { resident: 0, resident_family: 1, neighbor: 2, local: 3 }[relation];
}

function nowIso() {
  return new Date().toISOString();
}

function allMockBenefits() {
  return [...listStoredMockBenefits(), ...mockBenefits];
}

function allMockBusinesses() {
  const storedBenefits = listStoredMockBenefits();
  return [...mockBusinesses, ...listApprovedMockBusinesses()].map((business) => ({
    ...business,
    activeBenefit: storedBenefits.find((benefit) => benefit.businessId === business.id) ?? business.activeBenefit
  }));
}

function fromMockApplication(record: MockApplicationRecord): BusinessApplication {
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
    representativeImageObjectKey: record.representativeImageObjectKey,
    status: record.status,
    reviewNote: record.reviewNote,
    approvedBusinessId: record.approvedBusinessId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export class MockAdapter implements DataAdapter {
  private bookmarks = new Set<string>(['v5-1', 'v5-4']);
  private contacts: Record<string, BusinessContact[]> = {
    'v5-1': [{ type: 'phone', value: '010-0000-1001' }],
    'v5-3': [{ type: 'phone', value: '010-0000-1003' }, { type: 'sms', value: '문자 문의 가능' }],
    'v5-6': [{ type: 'phone', value: '010-0000-1006' }],
    'v5-10': [{ type: 'phone', value: '062-000-1010' }]
  };

  async listBusinesses(filters: BusinessFilters = {}): Promise<Business[]> {
    const query = filters.query?.trim().toLowerCase() || '';
    const category = filters.category && filters.category !== 'all' ? filters.category : null;
    const relation = filters.relation && filters.relation !== 'all' ? filters.relation : null;
    return allMockBusinesses()
      .filter((business) => !category || business.categorySlug === category || business.categoryName === category)
      .filter((business) => !relation || business.relationType === relation)
      .filter((business) => {
        if (!query) return true;
        return [business.name, business.summary, business.categoryName, business.activeBenefit?.title]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => relationRank(a.relationType) - relationRank(b.relationType));
  }

  async getBusiness(id: string): Promise<Business | null> {
    return allMockBusinesses().find((business) => business.id === id) ?? null;
  }

  async listBenefits(): Promise<Benefit[]> {
    return allMockBenefits();
  }

  async listPosts(): Promise<ComplexPost[]> {
    return [...listStoredMockPosts(), ...mockPosts];
  }

  async getBookmarks(): Promise<string[]> {
    return [...this.bookmarks];
  }

  async addBookmark(id: string): Promise<void> {
    this.bookmarks.add(id);
  }

  async removeBookmark(id: string): Promise<void> {
    this.bookmarks.delete(id);
  }

  async getBusinessContacts(id: string): Promise<BusinessContact[]> {
    return this.contacts[id] ? [...this.contacts[id]] : [{ type: 'phone', value: '010-0000-0000' }];
  }

  async createBusinessApplication(input: BusinessApplicationInput): Promise<BusinessApplication> {
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return fromMockApplication(createMockApplication(input, subject));
  }

  async listMyBusinessApplications(): Promise<BusinessApplication[]> {
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return listMockApplicationsForSubject(subject).map(fromMockApplication);
  }

  async getMyBusinessApplication(id: string): Promise<BusinessApplication | null> {
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    const record = getMockApplicationForSubject(id, subject);
    return record ? fromMockApplication(record) : null;
  }

  async resubmitBusinessApplication(id: string, input: BusinessApplicationInput): Promise<BusinessApplication> {
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return fromMockApplication(resubmitMockApplication(id, subject, input));
  }
}

type ApiEnvelope<T> = { data: T; requestId: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authProvider.headers('resident'),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function mapBenefit(raw: Record<string, unknown>): Benefit {
  return {
    id: String(raw.id),
    businessId: String(raw.business_id ?? raw.businessId ?? ''),
    businessName: String(raw.business_name ?? raw.businessName ?? ''),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    conditions: raw.conditions ? String(raw.conditions) : null
  };
}

function mapBusiness(raw: Record<string, unknown>): Business {
  const benefitList = Array.isArray(raw.benefits)
    ? raw.benefits as Array<Record<string, unknown>>
    : [];
  const activeRaw = (raw.active_benefit as Record<string, unknown> | null | undefined) ?? benefitList[0];
  const relationType = String(raw.relation_type ?? 'local') as RelationType;
  return {
    id: String(raw.id),
    kind: String(raw.kind ?? 'service') === 'shop' ? 'shop' : 'service',
    name: String(raw.name ?? ''),
    categorySlug: String(raw.category_slug ?? ''),
    categoryName: String(raw.category_name ?? ''),
    relationType,
    summary: String(raw.summary ?? ''),
    description: String(raw.description ?? raw.summary ?? ''),
    priceText: String(raw.price_text ?? '상담 후 안내'),
    serviceArea: String(raw.service_area ?? '방림동과 인근 지역'),
    availabilityText: String(raw.availability_text ?? '상담 후 안내'),
    icon: relationType === 'resident' ? '🏠' : relationType === 'neighbor' ? '🤝' : '📍',
    activeBenefit: activeRaw ? {
      id: String(activeRaw.id),
      businessId: String(raw.id),
      businessName: String(raw.name ?? ''),
      title: String(activeRaw.title ?? ''),
      description: String(activeRaw.description ?? ''),
      conditions: activeRaw.conditions ? String(activeRaw.conditions) : null
    } : null
  };
}

function mapApplication(raw: Record<string, unknown>): BusinessApplication {
  return {
    id: String(raw.id),
    relationType: String(raw.relation_type ?? 'resident') as RelationType,
    businessName: String(raw.business_name ?? ''),
    categoryName: String(raw.category_name ?? ''),
    serviceSummary: String(raw.service_summary ?? ''),
    priceText: raw.price_text ? String(raw.price_text) : undefined,
    contactMethod: raw.contact_method ? String(raw.contact_method) : undefined,
    serviceArea: raw.service_area ? String(raw.service_area) : undefined,
    benefitText: raw.benefit_text ? String(raw.benefit_text) : undefined,
    availabilityText: raw.availability_text ? String(raw.availability_text) : undefined,
    representativeImageObjectKey: raw.representative_image_object_key ? String(raw.representative_image_object_key) : undefined,
    status: String(raw.status ?? 'pending') as BusinessApplication['status'],
    reviewNote: raw.review_note ? String(raw.review_note) : null,
    approvedBusinessId: raw.approved_business_id ? String(raw.approved_business_id) : null,
    createdAt: String(raw.created_at ?? nowIso()),
    updatedAt: raw.updated_at ? String(raw.updated_at) : undefined
  };
}

export class ApiAdapter implements DataAdapter {
  async listBusinesses(filters: BusinessFilters = {}): Promise<Business[]> {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters.relation && filters.relation !== 'all') params.set('relation', filters.relation);
    const query = params.size ? `?${params.toString()}` : '';
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses${query}`);
    return rows.map(mapBusiness);
  }

  async getBusiness(id: string): Promise<Business | null> {
    try {
      const row = await request<Record<string, unknown>>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses/${id}`);
      return mapBusiness(row);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('not found')) return null;
      throw error;
    }
  }

  async listBenefits(): Promise<Benefit[]> {
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/benefits`);
    return rows.map(mapBenefit);
  }

  async listPosts(): Promise<ComplexPost[]> {
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/posts`);
    return rows.map((raw) => ({
      id: String(raw.id),
      sourceName: String(raw.source_name ?? ''),
      category: String(raw.category ?? ''),
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      publishedAt: String(raw.published_at ?? '')
    }));
  }

  async getBookmarks(): Promise<string[]> {
    const rows = await request<Array<Record<string, unknown>>>('/api/v1/me/bookmarks');
    return rows.map((row) => String(row.id));
  }

  async addBookmark(id: string): Promise<void> {
    await request(`/api/v1/me/bookmarks/${id}`, { method: 'POST' });
  }

  async removeBookmark(id: string): Promise<void> {
    await request(`/api/v1/me/bookmarks/${id}`, { method: 'DELETE' });
  }

  async getBusinessContacts(id: string): Promise<BusinessContact[]> {
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses/${id}/contact`);
    return rows.map((raw) => ({
      type: String(raw.contact_type ?? 'phone') as BusinessContact['type'],
      value: String(raw.contact_value ?? '')
    }));
  }

  async createBusinessApplication(input: BusinessApplicationInput): Promise<BusinessApplication> {
    const idempotencyKey = createApplicationIdempotencyKey();
    const body = JSON.stringify({ complexSlug: COMPLEX_SLUG, ...input });
    const submit = () => request<Record<string, unknown>>('/api/v1/me/business-applications', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body
    });
    const row = await retryNetworkOnce(submit);
    return {
      ...mapApplication(row),
      relationType: input.relationType,
      businessName: input.businessName,
      categoryName: input.categoryName,
      serviceSummary: input.serviceSummary,
      priceText: input.priceText,
      contactMethod: input.contactMethod,
      serviceArea: input.serviceArea,
      benefitText: input.benefitText,
      availabilityText: input.availabilityText,
      representativeImageObjectKey: input.representativeImageObjectKey
    };
  }

  async listMyBusinessApplications(): Promise<BusinessApplication[]> {
    const rows = await request<Record<string, unknown>[]>('/api/v1/me/business-applications');
    return rows.map(mapApplication);
  }

  async getMyBusinessApplication(id: string): Promise<BusinessApplication | null> {
    try {
      const row = await request<Record<string, unknown>>(`/api/v1/me/business-applications/${id}`);
      return mapApplication(row);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('not found')) return null;
      throw error;
    }
  }

  async resubmitBusinessApplication(id: string, input: BusinessApplicationInput): Promise<BusinessApplication> {
    const row = await request<Record<string, unknown>>(`/api/v1/me/business-applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    return mapApplication(row);
  }
}

export const dataAdapter: DataAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdapter()
  : new MockAdapter();
