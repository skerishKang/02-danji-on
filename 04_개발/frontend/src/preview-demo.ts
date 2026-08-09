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

export const PREVIEW_DEMO_ROLES: readonly PreviewDemoActor[] = [
  {
    role: 'anonymous',
    subject: null,
    displayName: '일반 방문자',
    label: '일반 방문자',
    description: '로그인하지 않은 공개 화면과 인증 요구 경계를 확인합니다.',
    verified: false,
    manager: false,
    permissions: { browse: true, contact: false, benefit: false, register: false, approve: false },
    recommendedTest: '가게 탐색은 되고 문의처·혜택·등록·운영 기능은 막히는지 확인'
  },
  {
    role: 'resident',
    subject: 'dev-resident-001',
    displayName: '시연 인증 입주민',
    label: '인증 입주민',
    description: '문의·주민혜택·내 일 알리기를 테스트 DB에서 검증합니다.',
    verified: true,
    manager: false,
    permissions: { browse: true, contact: true, benefit: true, register: true, approve: false },
    recommendedTest: '문의처 보기 → 주민혜택 → 내 일 알리기까지 진행하고 운영 승인은 막히는지 확인'
  },
  {
    role: 'unverified',
    subject: 'dev-unverified-001',
    displayName: '시연 미인증 주민',
    label: '미인증 주민',
    description: '단지 멤버이지만 입주민 인증 전이라 문의처·주민혜택이 막히는 경계를 확인합니다.',
    verified: false,
    manager: false,
    permissions: { browse: true, contact: false, benefit: false, register: true, approve: false },
    recommendedTest: '내 일 신청은 가능하지만 문의처·주민혜택은 입주민 인증 요구로 막히는지 확인'
  },
  {
    role: 'manager',
    subject: 'dev-manager-001',
    displayName: '시연 운영자',
    label: '운영자',
    description: '검증된 단지 운영자 계정으로 주민 기능과 신청 검토·승인을 함께 확인합니다.',
    verified: true,
    manager: true,
    permissions: { browse: true, contact: true, benefit: true, register: true, approve: true },
    recommendedTest: '인증 입주민이 만든 신청을 운영관리에서 확인하고 승인한 뒤 공개 목록 재노출 확인'
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
