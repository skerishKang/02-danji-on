import { adminAdapter, type AdminApplication } from './admin-api';
import { authProvider } from './auth';
import { authenticatedFetch } from './auth-fetch';

export interface ApplicationDocumentSummary {
  id: string;
  kind: string;
  sortOrder: number;
}

export interface OperationsReviewContext {
  id: string;
  status: AdminApplication['status'];
  approvedBusinessId?: string | null;
  // #312: opaque document summaries (id/kind/sort order). The byte route is
  // keyed by id; object keys are never sent to the reviewer UI.
  documents?: ApplicationDocumentSummary[];
  publicProfile: {
    businessName: string;
    categoryName: string;
    serviceSummary: string;
    priceText?: string;
    serviceArea?: string;
    availabilityText?: string;
    benefitText?: string;
    representativeImageObjectKey?: string;
  };
  privateVerification: {
    applicantName: string;
    relationType: string;
    membershipVerificationStatus: string;
    evidenceCount: number;
  };
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

type ApiEnvelope<T> = { data: T; requestId: string };

function mockContext(application: AdminApplication): OperationsReviewContext {
  const residenceLinked = application.relationType === 'resident' || application.relationType === 'resident_family';
  return {
    id: application.id,
    status: application.status,
    approvedBusinessId: application.approvedBusinessId,
    publicProfile: {
      businessName: application.businessName,
      categoryName: application.categoryName,
      serviceSummary: application.serviceSummary,
      priceText: application.priceText,
      serviceArea: application.serviceArea,
      availabilityText: application.availabilityText,
      benefitText: application.benefitText
    },
    privateVerification: {
      applicantName: application.applicantName,
      relationType: application.relationType,
      membershipVerificationStatus: residenceLinked ? 'verified' : 'not_required',
      evidenceCount: residenceLinked ? 1 : 0
    }
  };
}

// The backend review-context response carries reviewBasis/photoObjectKeys, not
// the privateVerification shape this UI renders. Map it here so the page works
// unchanged in API mode; unknown fields (photoObjectKeys) are dropped.
type RawReviewContext = {
  id: string;
  status: AdminApplication['status'];
  approvedBusinessId?: string | null;
  documents?: ApplicationDocumentSummary[];
  publicProfile?: OperationsReviewContext['publicProfile'];
  reviewBasis?: {
    applicantDisplayName?: string;
    relationType?: string;
    membershipVerificationStatus?: string;
    verificationEvidenceCount?: number;
  };
};

function normalizeContext(raw: RawReviewContext): OperationsReviewContext {
  return {
    id: raw.id,
    status: raw.status,
    approvedBusinessId: raw.approvedBusinessId,
    documents: raw.documents ?? [],
    publicProfile: raw.publicProfile ?? { businessName: '', categoryName: '', serviceSummary: '' },
    privateVerification: {
      applicantName: raw.reviewBasis?.applicantDisplayName ?? '',
      relationType: raw.reviewBasis?.relationType ?? '',
      membershipVerificationStatus: raw.reviewBasis?.membershipVerificationStatus ?? 'pending',
      evidenceCount: Number(raw.reviewBasis?.verificationEvidenceCount ?? 0)
    }
  };
}

async function apiContext(id: string): Promise<OperationsReviewContext> {
  const response = await fetch(`${API_BASE}/api/v1/admin/business-applications/${encodeURIComponent(id)}/review-context`, {
    headers: {
      'content-type': 'application/json',
      ...authProvider.headers('admin')
    }
  });
  const payload = await response.json() as ApiEnvelope<RawReviewContext> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Review context request failed: ${response.status}`);
  }
  return normalizeContext((payload as ApiEnvelope<RawReviewContext>).data);
}

export async function getOperationsReviewContext(id: string): Promise<OperationsReviewContext | null> {
  if (import.meta.env.VITE_DATA_MODE === 'api') return apiContext(id);
  const applications = await adminAdapter.listApplications('all');
  const application = applications.find((item) => item.id === id);
  return application ? mockContext(application) : null;
}

export async function approveOperationsApplication(id: string, reviewNote: string) {
  await adminAdapter.reviewApplication(id, 'approved', reviewNote);
  const [context, businesses] = await Promise.all([
    getOperationsReviewContext(id),
    adminAdapter.listBusinesses()
  ]);
  return { context, businesses };
}

export async function countPublishedBusinesses() {
  return (await adminAdapter.listBusinesses()).length;
}

export class ApplicationDocumentAccessError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApplicationDocumentAccessError';
    this.status = status;
    this.code = code;
  }
}

export interface OpenedApplicationDocument {
  blob: Blob;
  mimeType: string;
  inline: boolean;
}

// #312: bytes are fetched only through the admin byte route, keyed by the
// opaque document id from the review context. There is no objectKey authority,
// no Drive URL, and every denial renders from the backend's truthful state.
function adminDocumentRoute(applicationId: string, documentId: string): string {
  return `${API_BASE}/api/v1/admin/business-applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(documentId)}`;
}

function documentAccessMessage(status: number, code: string): string {
  if (status === 401) return '운영자 인증이 필요합니다. 다시 로그인한 뒤 시도해 주세요.';
  if (status === 403) return code === 'DOCUMENT_ACCESS_DENIED'
    ? '반려되었거나 검토 대상이 아닌 신청의 서류입니다. 열람할 수 없습니다.'
    : '이 서류를 열람할 권한이 없습니다.';
  if (status === 404) return '서류를 찾을 수 없습니다.';
  if (status === 409) return '비활성 처리된 서류입니다. 열람할 수 없습니다.';
  if (status === 503 && code === 'AUDIT_UNAVAILABLE') return '열람 기록을 남길 수 없어 서류 열람이 차단되었습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return '서류 열람 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  return `서류 열람에 실패했습니다. (${status})`;
}

export async function openOperationsApplicationDocument(
  applicationId: string,
  documentId: string
): Promise<OpenedApplicationDocument> {
  const response = await authenticatedFetch(adminDocumentRoute(applicationId, documentId), { method: 'GET' }, 'admin');
  if (!response.ok) {
    let code = '';
    try {
      const payload = await response.json() as { error?: { code?: string } };
      code = payload.error?.code ?? '';
    } catch {
      code = '';
    }
    throw new ApplicationDocumentAccessError(documentAccessMessage(response.status, code), response.status, code);
  }
  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const disposition = response.headers.get('content-disposition') ?? '';
  const blob = await response.blob();
  return { blob, mimeType, inline: disposition.startsWith('inline') || mimeType.startsWith('image/') };
}
