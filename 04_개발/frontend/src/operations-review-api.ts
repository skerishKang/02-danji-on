import { adminAdapter, type AdminApplication } from './admin-api';
import { authProvider } from './auth';

export interface OperationsReviewContext {
  id: string;
  status: AdminApplication['status'];
  approvedBusinessId?: string | null;
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

async function apiContext(id: string): Promise<OperationsReviewContext> {
  const response = await fetch(`${API_BASE}/api/v1/admin/business-applications/${encodeURIComponent(id)}/review-context`, {
    headers: {
      'content-type': 'application/json',
      ...authProvider.headers('admin')
    }
  });
  const payload = await response.json() as ApiEnvelope<OperationsReviewContext> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Review context request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<OperationsReviewContext>).data;
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
