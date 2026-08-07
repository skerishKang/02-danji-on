export type RelationType = 'resident' | 'resident_family' | 'neighbor' | 'local';

export type BusinessKind = 'shop' | 'service';

export interface Benefit {
  id: string;
  businessId: string;
  businessName: string;
  title: string;
  description: string;
  conditions?: string | null;
}

export interface Business {
  id: string;
  kind: BusinessKind;
  name: string;
  categorySlug: string;
  categoryName: string;
  relationType: RelationType;
  summary: string;
  description: string;
  priceText: string;
  serviceArea: string;
  availabilityText: string;
  icon: string;
  activeBenefit?: Benefit | null;
}

export interface ComplexPost {
  id: string;
  sourceName: string;
  category: string;
  title: string;
  body: string;
  publishedAt: string;
}

export interface BusinessFilters {
  query?: string;
  category?: string;
  relation?: RelationType | 'all';
}

export interface DataAdapter {
  listBusinesses(filters?: BusinessFilters): Promise<Business[]>;
  getBusiness(id: string): Promise<Business | null>;
  listBenefits(): Promise<Benefit[]>;
  listPosts(): Promise<ComplexPost[]>;
  getBookmarks(): Promise<string[]>;
  addBookmark(id: string): Promise<void>;
  removeBookmark(id: string): Promise<void>;
}

export const relationLabels: Record<RelationType, string> = {
  resident: '방림명지로드힐 주민 운영',
  resident_family: '방림명지로드힐 주민 가족 운영',
  neighbor: '이웃 단지 주민 운영',
  local: '우리 동네 가게'
};
