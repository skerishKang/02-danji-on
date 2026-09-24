export type ResidentProfileServerLabel =
  | 'verified_resident'
  | 'operator'
  | 'account';

export type ResidentProfileLabel = ResidentProfileServerLabel | 'unknown';

export function parseResidentLabel(raw: unknown): ResidentProfileLabel {
  switch (raw) {
    case 'verified_resident':
    case 'operator':
    case 'account':
      return raw;
    default:
      return 'unknown';
  }
}

export function residentProfileLabelText(label: ResidentProfileLabel): string {
  switch (label) {
    case 'verified_resident':
      return '인증 주민';
    case 'operator':
      return '운영자 계정';
    case 'account':
      return '로그인 계정';
    case 'unknown':
    default:
      return '프로필 상태 확인 필요';
  }
}

export function residentProfileLabelEyebrow(label: ResidentProfileLabel): string {
  switch (label) {
    case 'verified_resident':
      return 'VERIFIED RESIDENT';
    case 'operator':
      return 'OPERATOR ACCOUNT';
    case 'account':
      return 'ACCOUNT';
    case 'unknown':
    default:
      return 'PROFILE STATUS';
  }
}
