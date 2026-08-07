import { authProvider } from './auth';
import {
  getMockResidentVerification,
  listMockResidentVerifications,
  reviewMockResidentVerification,
  submitMockResidentVerification
} from './mock-verification-store';
import type {
  ResidentVerificationInput,
  ResidentVerificationReviewInput,
  ResidentVerificationState,
  ResidentVerificationStatus
} from './verification-types';

const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

type ApiEnvelope<T> = { data: T; requestId: string };

async function apiRequest<T>(scope: 'resident' | 'admin', path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...authProvider.headers(scope),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Verification API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function mapResidentState(raw: Record<string, unknown>, fallbackSubject: string, fallbackName: string): ResidentVerificationState {
  const membership = (raw.membership as Record<string, unknown> | undefined) ?? raw;
  const verification = raw.verification as Record<string, unknown> | null | undefined;
  return {
    id: verification?.id ? String(verification.id) : raw.verification_id ? String(raw.verification_id) : null,
    membershipId: membership.id ? String(membership.id) : raw.membership_id ? String(raw.membership_id) : null,
    subject: fallbackSubject,
    displayName: fallbackName,
    complexSlug: String(membership.complex_slug ?? COMPLEX_SLUG),
    complexName: String(membership.complex_name ?? '방림명지로드힐'),
    status: String(membership.verification_status ?? raw.verification_status ?? 'unverified') as ResidentVerificationStatus,
    building: membership.building ? String(membership.building) : raw.building ? String(raw.building) : null,
    unit: membership.unit ? String(membership.unit) : raw.unit ? String(raw.unit) : null,
    method: verification?.method ? String(verification.method) as ResidentVerificationState['method'] : raw.method ? String(raw.method) as ResidentVerificationState['method'] : null,
    evidenceObjectKey: verification?.evidence_object_key ? String(verification.evidence_object_key) : raw.evidence_object_key ? String(raw.evidence_object_key) : null,
    requestedAt: verification?.requested_at ? String(verification.requested_at) : raw.requested_at ? String(raw.requested_at) : null,
    reviewedAt: verification?.reviewed_at ? String(verification.reviewed_at) : raw.reviewed_at ? String(raw.reviewed_at) : null,
    note: verification?.note ? String(verification.note) : raw.note ? String(raw.note) : null
  };
}

function mapAdminRow(raw: Record<string, unknown>): ResidentVerificationState {
  return {
    id: raw.id ? String(raw.id) : null,
    membershipId: raw.membership_id ? String(raw.membership_id) : null,
    subject: String(raw.auth_user_id ?? ''),
    displayName: String(raw.display_name ?? '입주민'),
    complexSlug: COMPLEX_SLUG,
    complexName: '방림명지로드힐',
    status: String(raw.verification_status ?? 'pending') as ResidentVerificationStatus,
    building: raw.building ? String(raw.building) : null,
    unit: raw.unit ? String(raw.unit) : null,
    method: raw.method ? String(raw.method) as ResidentVerificationState['method'] : null,
    evidenceObjectKey: raw.evidence_object_key ? String(raw.evidence_object_key) : null,
    requestedAt: raw.requested_at ? String(raw.requested_at) : null,
    reviewedAt: raw.reviewed_at ? String(raw.reviewed_at) : null,
    note: raw.note ? String(raw.note) : null
  };
}

class MockResidentVerificationAdapter {
  async get(): Promise<ResidentVerificationState> {
    const snapshot = authProvider.snapshot('resident');
    return getMockResidentVerification(snapshot.subject || 'dev-resident-001');
  }

  async submit(input: ResidentVerificationInput): Promise<ResidentVerificationState> {
    const snapshot = authProvider.snapshot('resident');
    return submitMockResidentVerification(snapshot.subject || 'dev-resident-001', input);
  }
}

class ApiResidentVerificationAdapter {
  async get(): Promise<ResidentVerificationState> {
    const snapshot = authProvider.snapshot('resident');
    const raw = await apiRequest<Record<string, unknown>>('resident', `/api/v1/me/complexes/${COMPLEX_SLUG}/resident-verification`);
    return mapResidentState(raw, snapshot.subject || '', snapshot.displayName);
  }

  async submit(input: ResidentVerificationInput): Promise<ResidentVerificationState> {
    const snapshot = authProvider.snapshot('resident');
    const raw = await apiRequest<Record<string, unknown>>('resident', `/api/v1/me/complexes/${COMPLEX_SLUG}/resident-verification`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return mapResidentState(raw, snapshot.subject || '', snapshot.displayName);
  }
}

class MockAdminVerificationAdapter {
  async list(status: ResidentVerificationStatus | 'all' = 'pending') {
    return listMockResidentVerifications(status);
  }

  async review(id: string, input: ResidentVerificationReviewInput) {
    return reviewMockResidentVerification(id, input);
  }
}

class ApiAdminVerificationAdapter {
  async list(status: ResidentVerificationStatus | 'all' = 'pending') {
    const params = new URLSearchParams({ status, limit: '200' });
    const rows = await apiRequest<Record<string, unknown>[]>('admin', `/api/v1/admin/complexes/${COMPLEX_SLUG}/resident-verifications?${params.toString()}`);
    return rows.map(mapAdminRow);
  }

  async review(id: string, input: ResidentVerificationReviewInput) {
    const raw = await apiRequest<Record<string, unknown>>('admin', `/api/v1/admin/resident-verifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    });
    const current = await this.list('all');
    return current.find((item) => item.id === id) ?? mapAdminRow(raw);
  }
}

export const residentVerificationAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiResidentVerificationAdapter()
  : new MockResidentVerificationAdapter();

export const adminVerificationAdapter = import.meta.env.VITE_DATA_MODE === 'api'
  ? new ApiAdminVerificationAdapter()
  : new MockAdminVerificationAdapter();
