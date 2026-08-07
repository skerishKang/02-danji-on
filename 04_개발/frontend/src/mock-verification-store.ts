import type {
  ResidentVerificationInput,
  ResidentVerificationReviewInput,
  ResidentVerificationState,
  ResidentVerificationStatus
} from './verification-types';

const STORAGE_KEY = 'danjion.mock.resident-verifications.v1';
const COMPLEX_SLUG = 'bangnim-myeongji-roadhill';
const COMPLEX_NAME = '방림명지로드힐';

const fixtures: ResidentVerificationState[] = [
  {
    id: 'mock-verification-resident-001',
    membershipId: 'mock-membership-resident-001',
    subject: 'dev-resident-001',
    displayName: '온이웃',
    complexSlug: COMPLEX_SLUG,
    complexName: COMPLEX_NAME,
    status: 'verified',
    building: '101',
    unit: '1001',
    method: 'management_confirmation',
    requestedAt: '2026-08-01T09:00:00+09:00',
    reviewedAt: '2026-08-01T10:00:00+09:00',
    note: '개발 fixture 인증 완료'
  },
  {
    id: null,
    membershipId: 'mock-membership-unverified-001',
    subject: 'dev-unverified-001',
    displayName: '미인증 주민',
    complexSlug: COMPLEX_SLUG,
    complexName: COMPLEX_NAME,
    status: 'unverified'
  }
];

function readStates(): ResidentVerificationState[] {
  if (typeof window === 'undefined') return fixtures.map((item) => ({ ...item }));
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    writeStates(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ResidentVerificationState[] : fixtures.map((item) => ({ ...item }));
  } catch {
    writeStates(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
}

function writeStates(states: ResidentVerificationState[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
}

function ensureSubject(subject: string): ResidentVerificationState {
  const states = readStates();
  const found = states.find((item) => item.subject === subject);
  if (found) return found;
  const created: ResidentVerificationState = {
    id: null,
    membershipId: `mock-membership-${subject}`,
    subject,
    displayName: subject,
    complexSlug: COMPLEX_SLUG,
    complexName: COMPLEX_NAME,
    status: 'unverified'
  };
  writeStates([...states, created]);
  return created;
}

export function getMockResidentVerification(subject: string): ResidentVerificationState {
  return { ...ensureSubject(subject) };
}

export function setMockResidentVerificationStatus(subject: string, status: ResidentVerificationStatus) {
  const states = readStates();
  const current = ensureSubject(subject);
  const updated: ResidentVerificationState = { ...current, status };
  const next = states.some((item) => item.subject === subject)
    ? states.map((item) => item.subject === subject ? updated : item)
    : [...states, updated];
  writeStates(next);
  return { ...updated };
}

export function submitMockResidentVerification(subject: string, input: ResidentVerificationInput): ResidentVerificationState {
  const states = readStates();
  const current = ensureSubject(subject);
  if (current.status === 'verified') throw new Error('이미 입주민 인증이 완료되어 있습니다.');
  const now = new Date().toISOString();
  const updated: ResidentVerificationState = {
    ...current,
    id: current.id || `mock-verification-${crypto.randomUUID()}`,
    status: 'pending',
    building: input.building,
    unit: input.unit,
    method: input.method,
    evidenceObjectKey: input.evidenceObjectKey || null,
    requestedAt: now,
    reviewedAt: null,
    note: null
  };
  const next = states.some((item) => item.subject === subject)
    ? states.map((item) => item.subject === subject ? updated : item)
    : [...states, updated];
  writeStates(next);
  return { ...updated };
}

export function listMockResidentVerifications(status: ResidentVerificationStatus | 'all' = 'pending') {
  const states = readStates().filter((item) => item.id || item.status !== 'unverified');
  return status === 'all' ? states.map((item) => ({ ...item })) : states.filter((item) => item.status === status).map((item) => ({ ...item }));
}

export function reviewMockResidentVerification(id: string, input: ResidentVerificationReviewInput) {
  const states = readStates();
  const index = states.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('입주민 인증 신청을 찾을 수 없습니다.');
  const current = states[index];
  if (!['pending', 'rejected'].includes(current.status)) throw new Error('현재 상태에서는 인증을 검토할 수 없습니다.');
  const updated: ResidentVerificationState = {
    ...current,
    status: input.status,
    reviewedAt: new Date().toISOString(),
    note: input.note || null
  };
  states[index] = updated;
  writeStates(states);
  return { ...updated };
}

export function resetMockResidentVerifications() {
  writeStates(fixtures);
}
