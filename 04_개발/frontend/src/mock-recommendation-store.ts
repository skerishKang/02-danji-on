import type {
  AdminRecommendation,
  AdminRecommendationReviewStatus,
  AdminRecommendationStatus,
  RecommendationReviewResult
} from './admin-api';

// In-memory mock parity for the Report R-B reviewer queue (#315).
// Mirrors the merged backend authority (#308): approval requires
// resolved_category_id + resolved_relation_type; unresolved approvals fall
// back to changes_requested with a categoryUnresolved marker. Legacy
// categoryName / relationType are history only and never gate approval.
const UNRESOLVED_APPROVAL_NOTE = '카테고리 또는 관계를 확인할 수 없어 승인이 보류되었습니다. 확인 후 다시 제출해 주세요.';

const recommendations: AdminRecommendation[] = [
  {
    id: 'mock-rec-1',
    businessName: '정다운 헤어',
    serviceSummary: '가족이 운영하는 생활 미용 서비스로 커트와 기본 관리를 제공합니다.',
    serviceArea: '방림동 인근',
    reporterNote: '입주민 커트 할인도 해주셔서 자주 이용합니다.',
    reportedRelationRaw: 'family',
    relationDetail: null,
    reportPrice: '커트 15,000원',
    reportHours: '화-일 10:00-19:00',
    categoryName: '이미용',
    relationType: 'resident_family',
    resolvedCategoryId: 'mock-category-beauty',
    resolvedRelationType: 'resident_family',
    status: 'pending',
    reviewNote: null,
    approvedBusinessId: null,
    reporterNickname: '산책메이트',
    createdAt: '2026-09-08T02:00:00.000Z',
    updatedAt: '2026-09-08T02:00:00.000Z'
  },
  {
    id: 'mock-rec-2',
    businessName: '고마운 청소 서비스',
    serviceSummary: '입주 전 청소와 정기 방문 청소를 합니다.',
    serviceArea: '광주 남구 방문',
    reporterNote: '지인의 지인이 운영해서 관계 설명이 필요했습니다.',
    reportedRelationRaw: 'etc',
    relationDetail: '지인의 지인 소개',
    reportPrice: null,
    reportHours: null,
    categoryName: null,
    relationType: null,
    resolvedCategoryId: null,
    resolvedRelationType: null,
    status: 'pending',
    reviewNote: null,
    approvedBusinessId: null,
    reporterNickname: '연블리',
    createdAt: '2026-09-09T01:30:00.000Z',
    updatedAt: '2026-09-09T01:30:00.000Z'
  }
];

function copyRecommendation(recommendation: AdminRecommendation): AdminRecommendation {
  return { ...recommendation };
}

export function listMockRecommendations(status: AdminRecommendationStatus = 'pending'): AdminRecommendation[] {
  return recommendations
    .filter((recommendation) => recommendation.status === status)
    .map(copyRecommendation);
}

export function getMockRecommendation(id: string): AdminRecommendation | null {
  const found = recommendations.find((recommendation) => recommendation.id === id);
  return found ? copyRecommendation(found) : null;
}

export function reviewMockRecommendation(
  id: string,
  status: AdminRecommendationReviewStatus,
  reviewNote: string
): RecommendationReviewResult {
  const current = recommendations.find((recommendation) => recommendation.id === id);
  if (!current) throw new Error('제보를 찾을 수 없습니다.');
  if (!['pending', 'changes_requested'].includes(current.status)) {
    throw new Error('현재 상태에서는 검토할 수 없습니다.');
  }
  const note = reviewNote.trim() || null;
  if (status === 'approved') {
    if (!current.resolvedCategoryId || !current.resolvedRelationType) {
      current.status = 'changes_requested';
      current.reviewNote = note || UNRESOLVED_APPROVAL_NOTE;
      current.updatedAt = new Date().toISOString();
      return {
        id: current.id,
        status: 'changes_requested',
        reviewNote: current.reviewNote,
        categoryUnresolved: 'REPORT_RB_UNRESOLVED'
      };
    }
    current.status = 'approved';
    current.reviewNote = note;
    current.approvedBusinessId = current.approvedBusinessId || `mock-business-${current.id}`;
    current.updatedAt = new Date().toISOString();
    return { id: current.id, status: 'approved', reviewNote: current.reviewNote, approvedBusinessId: current.approvedBusinessId };
  }
  current.status = status;
  current.reviewNote = note;
  current.updatedAt = new Date().toISOString();
  return { id: current.id, status, reviewNote: current.reviewNote, approvedBusinessId: current.approvedBusinessId };
}
