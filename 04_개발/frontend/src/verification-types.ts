export type ResidentVerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type ResidentVerificationMethod = 'document' | 'management_confirmation' | 'manual';

export interface ResidentVerificationState {
  id?: string | null;
  membershipId?: string | null;
  subject: string;
  displayName: string;
  complexSlug: string;
  complexName: string;
  status: ResidentVerificationStatus;
  building?: string | null;
  unit?: string | null;
  method?: ResidentVerificationMethod | null;
  evidenceObjectKey?: string | null;
  requestedAt?: string | null;
  reviewedAt?: string | null;
  note?: string | null;
}

export interface ResidentVerificationInput {
  building: string;
  unit: string;
  method: ResidentVerificationMethod;
  evidenceObjectKey?: string | null;
}

export interface ResidentVerificationReviewInput {
  status: 'verified' | 'rejected';
  note?: string;
}
