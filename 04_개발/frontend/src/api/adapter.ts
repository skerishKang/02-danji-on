import { authenticatedFetch } from '../auth-fetch';
import { authProvider } from '../auth';
import { mockBenefits, mockBusinesses, mockPosts } from '../data/mock';
import { listStoredMockBenefits, listStoredMockPosts } from '../mock-content-store';
import { claimMockBenefit, listMockBenefitClaims, useMockBenefit } from '../mock-benefit-wallet-store';
import {
  createMockApplication,
  getMockApplicationForSubject,
  listApprovedMockBusinesses,
  listMockApplicationsForSubject,
  resubmitMockApplication,
  type MockApplicationRecord
} from '../mock-store';
import type {
  ActivityItem,
  ActivityListOptions,
  ActivityPage,
  Benefit,
  BenefitClaim,
  Business,
  BusinessApplication,
  BusinessApplicationInput,
  BusinessContact,
  BusinessFilters,
  BusinessShareRef,
  ComplexPost,
  DataAdapter,
  RelationType,
  ShopRecommendation,
  ShopRecommendationInput,
  ShopRecommendationRelationType
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

const MOCK_ACTIVITY: ActivityItem[] = [
  {
    type: 'review', id: 'mock-activity-review', occurredAt: '2026-09-02T08:00:00.000Z', status: 'active',
    targetType: 'business', targetId: 'v5-1', parentCommentId: null,
    title: '오늘의 반찬', bodyPreview: '이웃에게 도움이 되는 후기를 남겼습니다.'
  },
  {
    type: 'reaction', id: 'mock-activity-reaction', occurredAt: '2026-09-02T07:00:00.000Z', status: 'published',
    targetType: 'community_post', targetId: 'mock-post-2', parentCommentId: null,
    title: '주민 생활정보', bodyPreview: null
  },
  {
    type: 'reply', id: 'mock-activity-reply', occurredAt: '2026-09-02T06:00:00.000Z', status: 'published',
    targetType: 'community_post', targetId: 'mock-post-1', parentCommentId: 'mock-comment-1',
    title: '우리 단지 이야기', bodyPreview: '답글을 남겼습니다.'
  },
  {
    type: 'comment', id: 'mock-activity-comment', occurredAt: '2026-09-02T05:00:00.000Z', status: 'published',
    targetType: 'community_post', targetId: 'mock-post-1', parentCommentId: null,
    title: '우리 단지 이야기', bodyPreview: '댓글을 남겼습니다.'
  },
  {
    type: 'post', id: 'mock-activity-post', occurredAt: '2026-09-02T04:00:00.000Z', status: 'published',
    targetType: 'community_post', targetId: 'mock-post-1', parentCommentId: null,
    title: '우리 단지 이야기', bodyPreview: '주민 게시글을 작성했습니다.'
  }
];

function activityFilterMatches(item: ActivityItem, type: ActivityListOptions['type']): boolean {
  if (!type || type === 'all') return true;
  if (type === 'posts') return item.type === 'post';
  if (type === 'comments') return item.type === 'comment' || item.type === 'reply';
  if (type === 'reactions') return item.type === 'reaction';
  return item.type === 'review';
}

function mockShareSlug(businessId: string): string {
  return `demo-${businessId.toLowerCase()}`;
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

  async getBusinessShare(id: string): Promise<BusinessShareRef> {
    return { businessId: id, shareSlug: mockShareSlug(id) };
  }

  async resolveBusinessShare(shareSlug: string): Promise<BusinessShareRef> {
    if (!shareSlug.startsWith('demo-') || shareSlug.length <= 'demo-'.length) {
      throw new Error('공유 링크를 찾을 수 없습니다.');
    }
    const businessId = shareSlug.slice('demo-'.length);
    return { businessId, shareSlug };
  }

  async listBenefits(): Promise<Benefit[]> {
    return allMockBenefits();
  }

  async listBenefitClaims(): Promise<BenefitClaim[]> {
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return listMockBenefitClaims(subject, allMockBenefits());
  }

  async claimBenefit(benefitId: string): Promise<BenefitClaim> {
    const benefit = allMockBenefits().find((item) => item.id === benefitId);
    if (!benefit) throw new Error('주민혜택을 찾을 수 없습니다.');
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return claimMockBenefit(subject, benefit);
  }

  async useBenefit(benefitId: string): Promise<BenefitClaim> {
    const benefit = allMockBenefits().find((item) => item.id === benefitId);
    if (!benefit) throw new Error('주민혜택을 찾을 수 없습니다.');
    const subject = authProvider.snapshot('resident').subject || 'dev-resident-001';
    return useMockBenefit(subject, benefit);
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

  async createShopRecommendation(input: ShopRecommendationInput): Promise<ShopRecommendation> {
    const createdAt = nowIso();
    return {
      id: `mock-recommendation-${crypto.randomUUID()}`,
      relationType: input.relationType,
      businessName: input.businessName,
      categoryName: input.categoryName,
      serviceSummary: input.serviceSummary,
      serviceArea: input.serviceArea || null,
      reporterNote: input.reporterNote || null,
      status: 'pending',
      reviewNote: null,
      approvedBusinessId: null,
      createdAt,
      updatedAt: createdAt
    };
  }

  async listMyActivity(options: ActivityListOptions = {}): Promise<ActivityPage> {
    const filtered = MOCK_ACTIVITY.filter((item) => activityFilterMatches(item, options.type));
    const rawOffset = options.cursor?.startsWith('mock-activity:')
      ? Number(options.cursor.slice('mock-activity:'.length))
      : 0;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const requested = Number.isInteger(options.limit) ? Number(options.limit) : 5;
    const limit = Math.min(Math.max(requested, 1), 50);
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < filtered.length ? `mock-activity:${nextOffset}` : null
    };
  }
}

type ApiEnvelope<T> = { data: T; requestId: string };
type RequestOptions = { auth?: boolean };

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  const target = `${API_BASE}${path}`;
  const requestInit: RequestInit = {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  };
  const response = options.auth === false
    ? await fetch(target, requestInit)
    : await authenticatedFetch(target, requestInit, 'resident');
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

function mapBenefitClaim(raw: Record<string, unknown>): BenefitClaim {
  return {
    id: String(raw.id),
    benefitId: String(raw.benefit_id ?? raw.benefitId ?? ''),
    businessId: String(raw.business_id ?? raw.businessId ?? ''),
    businessName: String(raw.business_name ?? raw.businessName ?? ''),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    conditions: raw.conditions ? String(raw.conditions) : null,
    code: String(raw.claim_code ?? raw.code ?? ''),
    status: String(raw.status ?? 'stored') === 'used' ? 'used' : 'stored',
    claimedAt: String(raw.claimed_at ?? raw.claimedAt ?? nowIso()),
    usedAt: raw.used_at || raw.usedAt ? String(raw.used_at ?? raw.usedAt) : null
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
    representativeImageObjectKey: raw.representative_image_object_key ? String(raw.representative_image_object_key) : null,
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

function mapBusinessShare(raw: Record<string, unknown>): BusinessShareRef {
  return {
    businessId: String(raw.businessId ?? raw.business_id ?? ''),
    shareSlug: String(raw.shareSlug ?? raw.share_slug ?? '')
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

function mapRecommendation(raw: Record<string, unknown>): ShopRecommendation {
  return {
    id: String(raw.id),
    relationType: String(raw.relation_type ?? raw.relationType ?? 'local') as ShopRecommendationRelationType,
    businessName: String(raw.business_name ?? raw.businessName ?? ''),
    categoryName: String(raw.category_name ?? raw.categoryName ?? ''),
    serviceSummary: String(raw.service_summary ?? raw.serviceSummary ?? ''),
    serviceArea: raw.service_area || raw.serviceArea ? String(raw.service_area ?? raw.serviceArea) : null,
    reporterNote: raw.reporter_note || raw.reporterNote ? String(raw.reporter_note ?? raw.reporterNote) : null,
    status: String(raw.status ?? 'pending') as ShopRecommendation['status'],
    reviewNote: raw.review_note || raw.reviewNote ? String(raw.review_note ?? raw.reviewNote) : null,
    approvedBusinessId: raw.approved_business_id || raw.approvedBusinessId ? String(raw.approved_business_id ?? raw.approvedBusinessId) : null,
    createdAt: String(raw.created_at ?? raw.createdAt ?? nowIso()),
    updatedAt: raw.updated_at || raw.updatedAt ? String(raw.updated_at ?? raw.updatedAt) : undefined
  };
}

function mapActivity(raw: Record<string, unknown>): ActivityItem {
  return {
    type: String(raw.type ?? raw.activity_type) as ActivityItem['type'],
    id: String(raw.id),
    occurredAt: String(raw.occurredAt ?? raw.occurred_at ?? ''),
    status: String(raw.status ?? ''),
    targetType: String(raw.targetType ?? raw.target_type) as ActivityItem['targetType'],
    targetId: String(raw.targetId ?? raw.target_id ?? ''),
    parentCommentId: raw.parentCommentId || raw.parent_comment_id ? String(raw.parentCommentId ?? raw.parent_comment_id) : null,
    title: raw.title === null || raw.title === undefined ? null : String(raw.title),
    bodyPreview: raw.bodyPreview === null || raw.body_preview === null || (raw.bodyPreview === undefined && raw.body_preview === undefined)
      ? null
      : String(raw.bodyPreview ?? raw.body_preview)
  };
}

export class ApiAdapter implements DataAdapter {
  async listBusinesses(filters: BusinessFilters = {}): Promise<Business[]> {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.category && filters.category !== 'all') params.set('category', filters.category);
    if (filters.relation && filters.relation !== 'all') params.set('relation', filters.relation);
    const query = params.size ? `?${params.toString()}` : '';
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses${query}`, undefined, { auth: false });
    return rows.map(mapBusiness);
  }

  async getBusiness(id: string): Promise<Business | null> {
    try {
      const row = await request<Record<string, unknown>>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses/${id}`, undefined, { auth: false });
      return mapBusiness(row);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('not found')) return null;
      throw error;
    }
  }

  async getBusinessShare(id: string): Promise<BusinessShareRef> {
    const row = await request<Record<string, unknown>>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses/${id}/share`, undefined, { auth: false });
    return mapBusinessShare(row);
  }

  async resolveBusinessShare(shareSlug: string): Promise<BusinessShareRef> {
    const row = await request<Record<string, unknown>>(`/api/v1/complexes/${COMPLEX_SLUG}/businesses/share/${encodeURIComponent(shareSlug)}`, undefined, { auth: false });
    return mapBusinessShare(row);
  }

  async listBenefits(): Promise<Benefit[]> {
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/benefits`, undefined, { auth: false });
    return rows.map(mapBenefit);
  }

  async listBenefitClaims(): Promise<BenefitClaim[]> {
    const rows = await request<Record<string, unknown>[]>('/api/v1/me/benefits');
    return rows.map(mapBenefitClaim);
  }

  async claimBenefit(benefitId: string): Promise<BenefitClaim> {
    const row = await request<Record<string, unknown>>(`/api/v1/me/benefits/${benefitId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ complexSlug: COMPLEX_SLUG })
    });
    const benefit = await this.listBenefits().then((rows) => rows.find((item) => item.id === benefitId));
    return mapBenefitClaim({ ...row, ...(benefit ? { business_id: benefit.businessId, business_name: benefit.businessName, title: benefit.title, description: benefit.description, conditions: benefit.conditions } : {}) });
  }

  async useBenefit(benefitId: string): Promise<BenefitClaim> {
    const row = await request<Record<string, unknown>>(`/api/v1/me/benefits/${benefitId}/use`, { method: 'PATCH' });
    const existing = await this.listBenefitClaims().then((rows) => rows.find((item) => item.benefitId === benefitId));
    return existing ?? mapBenefitClaim(row);
  }

  async listPosts(): Promise<ComplexPost[]> {
    const rows = await request<Record<string, unknown>[]>(`/api/v1/complexes/${COMPLEX_SLUG}/posts`, undefined, { auth: false });
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

  async createShopRecommendation(input: ShopRecommendationInput): Promise<ShopRecommendation> {
    const row = await request<Record<string, unknown>>('/api/v1/me/shop-recommendations', {
      method: 'POST',
      body: JSON.stringify({ complexSlug: COMPLEX_SLUG, ...input })
    });
    return mapRecommendation(row);
  }

  async listMyActivity(options: ActivityListOptions = {}): Promise<ActivityPage> {
    const params = new URLSearchParams({ complexSlug: COMPLEX_SLUG });
    if (options.type && options.type !== 'all') params.set('type', options.type);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', options.cursor);
    const page = await request<{ items: Record<string, unknown>[]; nextCursor: string | null }>(`/api/v1/me/activity?${params.toString()}`);
    return {
      items: page.items.map(mapActivity),
      nextCursor: page.nextCursor || null
    };
  }
}

export const dataAdapter: DataAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdapter()
  : new MockAdapter();