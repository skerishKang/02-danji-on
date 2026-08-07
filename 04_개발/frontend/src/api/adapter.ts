import { mockBenefits, mockBusinesses, mockPosts } from '../data/mock';
import type { Benefit, Business, BusinessFilters, ComplexPost, DataAdapter, RelationType } from '../types';

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function devHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_USER) {
    headers['x-danjion-dev-auth-user'] = import.meta.env.VITE_DEV_AUTH_USER;
  }
  return headers;
}

function relationRank(relation: RelationType): number {
  return { resident: 0, resident_family: 1, neighbor: 2, local: 3 }[relation];
}

export class MockAdapter implements DataAdapter {
  private bookmarks = new Set<string>(['v5-1', 'v5-4']);

  async listBusinesses(filters: BusinessFilters = {}): Promise<Business[]> {
    const query = filters.query?.trim().toLowerCase() || '';
    const category = filters.category && filters.category !== 'all' ? filters.category : null;
    const relation = filters.relation && filters.relation !== 'all' ? filters.relation : null;
    return mockBusinesses
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
    return mockBusinesses.find((business) => business.id === id) ?? null;
  }

  async listBenefits(): Promise<Benefit[]> {
    return [...mockBenefits];
  }

  async listPosts(): Promise<ComplexPost[]> {
    return [...mockPosts];
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
}

type ApiEnvelope<T> = { data: T; requestId: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...devHeaders(), ...(init?.headers || {}) }
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
      if (error instanceof Error && error.message.includes('not found')) return null;
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
}

export const dataAdapter: DataAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdapter()
  : new MockAdapter();
