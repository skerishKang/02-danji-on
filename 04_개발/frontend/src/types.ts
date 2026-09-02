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

export type BenefitClaimStatus = 'stored' | 'used';

export interface BenefitClaim {
  id: string;
  benefitId: string;
  businessId: string;
  businessName: string;
  title: string;
  description: string;
  conditions?: string | null;
  code: string;
  status: BenefitClaimStatus;
  claimedAt: string;
  usedAt?: string | null;
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
  representativeImageObjectKey?: string | null;
  activeBenefit?: Benefit | null;
}

export interface BusinessContact {
  type: 'phone' | 'sms' | 'kakao' | 'url';
  value: string;
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

export interface BusinessApplicationInput {
  relationType: RelationType;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  priceText?: string;
  contactMethod?: string;
  serviceArea?: string;
  benefitText?: string;
  availabilityText?: string;
  representativeImageObjectKey?: string;
}

export type BusinessApplicationStatus = 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected';

export interface BusinessApplication {
  id: string;
  relationType: RelationType;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  priceText?: string;
  contactMethod?: string;
  serviceArea?: string;
  benefitText?: string;
  availabilityText?: string;
  representativeImageObjectKey?: string;
  status: BusinessApplicationStatus;
  reviewNote?: string | null;
  approvedBusinessId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type ShopRecommendationRelationType = Exclude<RelationType, 'resident'>;
export type ShopRecommendationStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';

export interface ShopRecommendationInput {
  relationType: ShopRecommendationRelationType;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  serviceArea?: string;
  reporterNote?: string;
}

export interface ShopRecommendation {
  id: string;
  relationType: ShopRecommendationRelationType;
  businessName: string;
  categoryName: string;
  serviceSummary: string;
  serviceArea?: string | null;
  reporterNote?: string | null;
  status: ShopRecommendationStatus;
  reviewNote?: string | null;
  approvedBusinessId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DataAdapter {
  listBusinesses(filters?: BusinessFilters): Promise<Business[]>;
  getBusiness(id: string): Promise<Business | null>;
  listBenefits(): Promise<Benefit[]>;
  listBenefitClaims(): Promise<BenefitClaim[]>;
  claimBenefit(benefitId: string): Promise<BenefitClaim>;
  useBenefit(benefitId: string): Promise<BenefitClaim>;
  listPosts(): Promise<ComplexPost[]>;
  getBookmarks(): Promise<string[]>;
  addBookmark(id: string): Promise<void>;
  removeBookmark(id: string): Promise<void>;
  getBusinessContacts(id: string): Promise<BusinessContact[]>;
  createBusinessApplication(input: BusinessApplicationInput): Promise<BusinessApplication>;
  listMyBusinessApplications(): Promise<BusinessApplication[]>;
  getMyBusinessApplication(id: string): Promise<BusinessApplication | null>;
  resubmitBusinessApplication(id: string, input: BusinessApplicationInput): Promise<BusinessApplication>;
  createShopRecommendation(input: ShopRecommendationInput): Promise<ShopRecommendation>;
}

export const relationLabels: Record<RelationType, string> = {
  resident: '방림명지로드힐 주민 운영',
  resident_family: '방림명지로드힐 주민 가족 운영',
  neighbor: '이웃 단지 주민 운영',
  local: '우리 동네 가게'
};

export const applicationStatusLabels: Record<BusinessApplicationStatus, string> = {
  draft: '작성 중',
  pending: '확인 대기',
  changes_requested: '보완 요청',
  approved: '승인 완료',
  rejected: '반려'
};

export const benefitClaimStatusLabels: Record<BenefitClaimStatus, string> = {
  stored: '보관 중',
  used: '사용 완료'
};
