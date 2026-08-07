import type { BusinessApplicationStatus } from './types';

export interface MockReviewEvent {
  id: string;
  applicationId: string;
  businessName: string;
  actorType: 'applicant' | 'manager' | 'system';
  actorName: string;
  fromStatus: BusinessApplicationStatus | null;
  toStatus: BusinessApplicationStatus;
  reviewNote?: string | null;
  createdAt: string;
}

const STORAGE_KEY = 'danjion.mock.application-review-events.v1';

const fixtures: MockReviewEvent[] = [
  {
    id: 'mock-review-event-1',
    applicationId: 'mock-admin-2',
    businessName: '맑은창 방충망 수리',
    actorType: 'manager',
    actorName: '개발 관리자',
    fromStatus: 'pending',
    toStatus: 'changes_requested',
    reviewNote: '서비스 가능 지역을 구체적으로 적어주세요.',
    createdAt: '2026-08-06T12:00:00+09:00'
  }
];

function readEvents(): MockReviewEvent[] {
  if (typeof window === 'undefined') return fixtures.map((item) => ({ ...item }));
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    writeEvents(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as MockReviewEvent[] : [];
  } catch {
    writeEvents(fixtures);
    return fixtures.map((item) => ({ ...item }));
  }
}

function writeEvents(events: MockReviewEvent[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export function recordMockReviewEvent(input: Omit<MockReviewEvent, 'id' | 'createdAt'>) {
  const event: MockReviewEvent = {
    ...input,
    id: `mock-review-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString()
  };
  writeEvents([event, ...readEvents()]);
  return event;
}

export function listMockReviewEvents(applicationId?: string | null) {
  const events = readEvents();
  return applicationId ? events.filter((event) => event.applicationId === applicationId) : events;
}

export function resetMockReviewEvents() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}
