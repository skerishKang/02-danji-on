export type PreviewDemoRole = 'anonymous' | 'resident' | 'unverified' | 'manager';
export type PreviewDemoCapability = 'browse' | 'contact' | 'benefit' | 'register' | 'approve';

export interface PreviewDemoActor {
  role: PreviewDemoRole;
  subject: string | null;
  displayName: string;
  label: string;
  description: string;
  verified: boolean;
  manager: boolean;
  permissions: Record<PreviewDemoCapability, boolean>;
  recommendedTest: string;
}

export const PREVIEW_DEMO_CAPABILITIES: readonly { key: PreviewDemoCapability; label: string; shortLabel: string }[] = [
  { key: 'browse', label: '공개 가게·서비스 보기', shortLabel: '공개 탐색' },
  { key: 'contact', label: '주민 전용 문의처 보기', shortLabel: '문의처' },
  { key: 'benefit', label: '주민혜택 받기·사용', shortLabel: '주민혜택' },
  { key: 'register', label: '내 일 알리기 신청', shortLabel: '내 일 등록' },
  { key: 'approve', label: '운영 신청 검토·승인', shortLabel: '운영 승인' }
] as const;

const SESSION_KEY = 'danjion-v2-preview-demo-role';

export const PREVIEW_DEMO_ENABLED = import.meta.env.VITE_PREVIEW_DEMO_MODE === 'true';

// Keep this order from least to most permission so the selector, permission matrix,
// and walkthrough video all tell the same story at a glance.
export const PREVIEW_DEMO_ROLES: readonly PreviewDemoActor[] = [
  {
    role: 'anonymous',
    subject: null,
    displayName: '일반 방문자',
    label: '일반 방문자',
    description: '로그인하지 않아도 공개된 이웃가게와 서비스는 자유롭게 둘러볼 수 있습니다.',
    verified: false,
    manager: false,
    permissions: { browse: true, contact: false, benefit: false, register: false, approve: false },
    recommendedTest: '가게 탐색은 가능하고 문의처·주민혜택·내 일 등록·운영 승인은 제한되는지 확인'
  },
  {
    role: 'unverified',
    subject: 'dev-unverified-001',
    displayName: '이웃 주민',
    label: '미인증 주민',
    description: '단지 회원이지만 입주민 인증 전이라 일부 주민 전용 기능은 아직 이용할 수 없습니다.',
    verified: false,
    manager: false,
    permissions: { browse: true, contact: false, benefit: false, register: true, approve: false },
    recommendedTest: '내 일 알리기는 가능하지만 문의처와 주민혜택은 입주민 인증 전이라 제한되는지 확인'
  },
  {
    role: 'resident',
    subject: 'dev-resident-001',
    displayName: '김하늘',
    label: '인증 입주민',
    description: '입주민 인증을 마친 주민으로 문의처, 주민혜택, 내 일 알리기를 이용할 수 있습니다.',
    verified: true,
    manager: false,
    permissions: { browse: true, contact: true, benefit: true, register: true, approve: false },
    recommendedTest: '문의처 확인 → 주민혜택 받기 → 내 일 알리기까지 진행하고 운영 승인은 제한되는지 확인'
  },
  {
    role: 'manager',
    subject: 'dev-manager-001',
    displayName: '단지온 운영자',
    label: '운영자',
    description: '입주민 기능과 함께 등록 신청을 검토하고 승인해 공개할 수 있습니다.',
    verified: true,
    manager: true,
    permissions: { browse: true, contact: true, benefit: true, register: true, approve: true },
    recommendedTest: '입주민이 등록한 신청을 확인하고 승인한 뒤 공개 목록에 나타나는지 확인'
  }
] as const;

function isPreviewDemoRole(value: string | null): value is PreviewDemoRole {
  return PREVIEW_DEMO_ROLES.some((item) => item.role === value);
}

export function getPreviewDemoRole(): PreviewDemoRole {
  if (!PREVIEW_DEMO_ENABLED || typeof window === 'undefined') return 'anonymous';
  const stored = window.sessionStorage.getItem(SESSION_KEY);
  return isPreviewDemoRole(stored) ? stored : 'anonymous';
}

export function setPreviewDemoRole(role: PreviewDemoRole) {
  if (!PREVIEW_DEMO_ENABLED || typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, role);
}

export function getPreviewDemoActor(): PreviewDemoActor {
  const role = getPreviewDemoRole();
  return PREVIEW_DEMO_ROLES.find((item) => item.role === role) ?? PREVIEW_DEMO_ROLES[0];
}
