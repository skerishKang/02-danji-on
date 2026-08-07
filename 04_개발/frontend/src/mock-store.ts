import type { Business, BusinessApplicationInput, BusinessApplicationStatus, RelationType } from './types';

export interface MockApplicationRecord {
  id: string;
  applicantSubject: string;
  applicantName: string;
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
  updatedAt: string;
}

const STORAGE_KEY = 'danjion.mock.business-applications.v1';

const fixtures: MockApplicationRecord[] = [
  {
    id: 'mock-admin-1',
    applicantSubject: 'dev-resident-001',
    applicantName: '온이웃',
    relationType: 'resident',
    businessName: '정성 홈베이킹',
    categoryName: '음식점·반찬·카페',
    serviceSummary: '주문형 수제 쿠키와 답례품',
    priceText: '상담 후 안내',
    benefitText: '첫 주문 10% 할인',
    status: 'pending',
    createdAt: '2026-08-07T09:00:00+09:00',
    updatedAt: '2026-08-07T09:00:00+09:00'
  },
  {
    id: 'mock-admin-2',
    applicantSubject: 'dev-resident-001',
    applicantName: '온이웃',
    relationType: 'resident_family',
    businessName: '맑은창 방충망 수리',
    categoryName: '청소·수리·에어컨 서비스',
    serviceSummary: '방충망 교체와 생활 수리',
    serviceArea: '광주 남구',
    status: 'changes_requested',
    reviewNote: '서비스 가능 지역을 구체적으로 적어주세요.',
    createdAt: '2026-08-06T09:00:00+09:00',
    updatedAt: '2026-08-06T12:00:00+09:00'
  },
  {
    id: 'mock-admin-3',
    applicantSubject: 'dev-neighbor-001',
    applicantName: '테스트 신청자',
    relationType: 'neighbor',
    businessName: '이웃 영어회화',
    categoryName: '과외·수업',
    serviceSummary: '영어회화 소규모 수업',
    status: 'pending',
    createdAt: '2026-08-05T09:00:00+09:00',
    updatedAt: '2026-08-05T09:00:00+09:00'
  }
];

function hasStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readRecords(): MockApplicationRecord[] {
  if (!hasStorage()) return fixtures.map((item) => ({ ...item }));
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    writeRecords(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('invalid mock store');
    return parsed as MockApplicationRecord[];
  } catch {
    writeRecords(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
}

function writeRecords(records: MockApplicationRecord[]) {
  if (!hasStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function categorySlug(value: string) {
  return `approved-${value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '') || 'category'}`;
}

function relationIcon(relation: RelationType) {
  if (relation === 'resident') return '🏠';
  if (relation === 'resident_family') return '👨‍👩‍👧';
  if (relation === 'neighbor') return '🤝';
  return '📍';
}

export function resetMockApplications() {
  writeRecords(fixtures);
}

export function createMockApplication(input: BusinessApplicationInput, applicantSubject: string, applicantName = '온이웃') {
  const now = new Date().toISOString();
  const record: MockApplicationRecord = {
    id: `mock-app-${crypto.randomUUID()}`,
    applicantSubject,
    applicantName,
    relationType: input.relationType,
    businessName: input.businessName,
    categoryName: input.categoryName,
    serviceSummary: input.serviceSummary,
    priceText: input.priceText,
    contactMethod: input.contactMethod,
    serviceArea: input.serviceArea,
    benefitText: input.benefitText,
    availabilityText: input.availabilityText,
    representativeImageObjectKey: input.representativeImageObjectKey,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  };
  const records = [record, ...readRecords()];
  writeRecords(records);
  return record;
}

export function listMockApplications(status: BusinessApplicationStatus | 'all' = 'all') {
  const records = readRecords();
  return status === 'all' ? records : records.filter((item) => item.status === status);
}

export function listMockApplicationsForSubject(subject: string) {
  return readRecords().filter((item) => item.applicantSubject === subject);
}

export function getMockApplicationForSubject(id: string, subject: string) {
  return readRecords().find((item) => item.id === id && item.applicantSubject === subject) ?? null;
}

export function resubmitMockApplication(id: string, subject: string, input: BusinessApplicationInput) {
  const records = readRecords();
  const index = records.findIndex((item) => item.id === id && item.applicantSubject === subject);
  if (index < 0) throw new Error('신청을 찾을 수 없습니다.');
  const current = records[index];
  if (current.status !== 'changes_requested') throw new Error('보완 요청 상태의 신청만 다시 제출할 수 있습니다.');
  const updated: MockApplicationRecord = {
    ...current,
    relationType: input.relationType,
    businessName: input.businessName,
    categoryName: input.categoryName,
    serviceSummary: input.serviceSummary,
    priceText: input.priceText,
    contactMethod: input.contactMethod,
    serviceArea: input.serviceArea,
    benefitText: input.benefitText,
    availabilityText: input.availabilityText,
    representativeImageObjectKey: input.representativeImageObjectKey,
    status: 'pending',
    updatedAt: new Date().toISOString()
  };
  records[index] = updated;
  writeRecords(records);
  return updated;
}

export function listApprovedMockBusinesses(): Business[] {
  return readRecords()
    .filter((item) => item.status === 'approved' && item.approvedBusinessId)
    .map((item) => {
      const businessId = item.approvedBusinessId as string;
      return {
        id: businessId,
        kind: 'service',
        name: item.businessName,
        categorySlug: categorySlug(item.categoryName),
        categoryName: item.categoryName,
        relationType: item.relationType,
        summary: item.serviceSummary,
        description: `${item.applicantName}님의 등록 신청이 승인되어 공개된 가게·서비스입니다.`,
        priceText: item.priceText || '상담 후 안내',
        serviceArea: item.serviceArea || '방림동과 인근 지역',
        availabilityText: item.availabilityText || '상담 후 안내',
        icon: relationIcon(item.relationType),
        activeBenefit: item.benefitText ? {
          id: `mock-approved-benefit-${item.id}`,
          businessId,
          businessName: item.businessName,
          title: item.benefitText,
          description: '등록 신청 승인 시 함께 공개된 주민혜택입니다.',
          conditions: '방림명지로드힐 인증 입주민 대상'
        } : null
      };
    });
}

export function reviewMockApplication(
  id: string,
  status: Exclude<BusinessApplicationStatus, 'draft' | 'pending'>,
  reviewNote: string
) {
  const records = readRecords();
  const index = records.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('신청을 찾을 수 없습니다.');
  const current = records[index];
  if (!['pending', 'changes_requested'].includes(current.status)) throw new Error('현재 상태에서는 검토할 수 없습니다.');
  const updated: MockApplicationRecord = {
    ...current,
    status,
    reviewNote: reviewNote || null,
    approvedBusinessId: status === 'approved' ? current.approvedBusinessId || `mock-business-${current.id}` : current.approvedBusinessId,
    updatedAt: new Date().toISOString()
  };
  records[index] = updated;
  writeRecords(records);
  return updated;
}
