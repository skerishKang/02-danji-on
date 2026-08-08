export type PreviewDemoRole = 'anonymous' | 'resident' | 'unverified' | 'manager';

export interface PreviewDemoActor {
  role: PreviewDemoRole;
  subject: string | null;
  displayName: string;
  label: string;
  description: string;
  verified: boolean;
  manager: boolean;
}

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
    manager: false
  },
  {
    role: 'resident',
    subject: 'dev-resident-001',
    displayName: '시연 인증 입주민',
    label: '인증 입주민',
    description: '저장·문의·주민혜택·내 일 알리기를 테스트 DB에서 검증합니다.',
    verified: true,
    manager: false
  },
  {
    role: 'unverified',
    subject: 'dev-unverified-001',
    displayName: '시연 미인증 주민',
    label: '미인증 주민',
    description: '로그인 상태여도 입주민 인증이 필요한 기능이 서버에서 막히는지 확인합니다.',
    verified: false,
    manager: false
  },
  {
    role: 'manager',
    subject: 'dev-manager-001',
    displayName: '시연 운영자',
    label: '운영자',
    description: '기존 관리자 권한 계약으로 신청 검토와 승인을 검증합니다.',
    verified: true,
    manager: true
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
