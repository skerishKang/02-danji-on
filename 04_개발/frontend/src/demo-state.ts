import { resetMockReviewEvents } from './mock-audit-store';
import { resetMockBenefitWallet } from './mock-benefit-wallet-store';
import { resetMockContent } from './mock-content-store';
import { resetMockApplications } from './mock-store';
import { resetMockResidentVerifications } from './mock-verification-store';
import { resetMockStorage } from './storage';

const SESSION_KEY = 'danjion.demo.session.v1';
const SEQUENCE_KEY = 'danjion.demo.sequence.v1';

export type DemoStatus = 'idle' | 'ready' | 'running' | 'complete';

export interface DemoSession {
  version: 1;
  status: DemoStatus;
  runId: string | null;
  preparedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastSurface: string;
  lastUrl: string;
  lastError: string | null;
}

const initialSession: DemoSession = {
  version: 1,
  status: 'idle',
  runId: null,
  preparedAt: null,
  startedAt: null,
  completedAt: null,
  lastSurface: '시연 콘솔',
  lastUrl: '/demo.html',
  lastError: null
};

function hasStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

export function readDemoSession(): DemoSession {
  if (!hasStorage()) return { ...initialSession };
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return { ...initialSession };
  try {
    const parsed = JSON.parse(raw) as Partial<DemoSession>;
    return { ...initialSession, ...parsed, version: 1 };
  } catch {
    return { ...initialSession };
  }
}

export function writeDemoSession(next: DemoSession) {
  if (!hasStorage()) return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('danjion:demo-session-changed', { detail: next }));
}

export async function prepareFieldDemo(): Promise<DemoSession> {
  if (import.meta.env.VITE_DATA_MODE === 'api') {
    throw new Error('실 API 모드에서는 시연 데이터를 자동 초기화하지 않습니다. Mock 모드에서만 사용하세요.');
  }

  resetMockApplications();
  resetMockReviewEvents();
  resetMockBenefitWallet();
  resetMockContent();
  resetMockResidentVerifications();
  await resetMockStorage();
  if (hasStorage()) window.localStorage.removeItem(SEQUENCE_KEY);

  const next: DemoSession = {
    ...initialSession,
    status: 'ready',
    preparedAt: new Date().toISOString(),
    lastSurface: '시연 시작 대기',
    lastUrl: '/demo.html',
    lastError: null
  };
  writeDemoSession(next);
  return next;
}

export async function startFieldDemo(): Promise<DemoSession> {
  let current = readDemoSession();
  if (current.status !== 'ready') current = await prepareFieldDemo();
  const next: DemoSession = {
    ...current,
    status: 'running',
    runId: `demo-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    startedAt: new Date().toISOString(),
    completedAt: null,
    lastSurface: '주민 발견 화면',
    lastUrl: '/?demo=1',
    lastError: null
  };
  writeDemoSession(next);
  return next;
}

export function recordDemoSurface(surface: string, url = `${window.location.pathname}${window.location.search}`) {
  const current = readDemoSession();
  if (current.status !== 'running') return current;
  const next: DemoSession = { ...current, lastSurface: surface, lastUrl: url, lastError: null };
  writeDemoSession(next);
  return next;
}

export function recordDemoError(message: string) {
  const current = readDemoSession();
  if (current.status !== 'running') return current;
  const next: DemoSession = { ...current, lastError: message.slice(0, 500) };
  writeDemoSession(next);
  return next;
}

export function markDemoComplete() {
  const current = readDemoSession();
  const next: DemoSession = {
    ...current,
    status: 'complete',
    completedAt: new Date().toISOString(),
    lastSurface: '생활경제 엔딩',
    lastUrl: `${window.location.pathname}${window.location.search}`,
    lastError: null
  };
  writeDemoSession(next);
  return next;
}

export function installDemoSessionTracking(surface: string) {
  if (typeof window === 'undefined') return;
  recordDemoSurface(surface);
  window.addEventListener('error', (event) => recordDemoError(event.message || '브라우저 오류가 발생했습니다.'));
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || '처리되지 않은 오류가 발생했습니다.');
    recordDemoError(reason);
  });
}
