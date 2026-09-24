import { parseResidentLabel, type ResidentProfileLabel } from './resident-profile-label';

export type ResidentPublicProfile = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  residentLabel: ResidentProfileLabel;
  joinedMonth: string;
  publicBio: string;
  publicActivityCount: number;
};

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function nonNegativeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function mapResidentProfile(raw: unknown): ResidentPublicProfile {
  const value = row(raw);
  return {
    userId: String(value.userId ?? ''),
    nickname: String(value.nickname ?? ''),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    residentLabel: parseResidentLabel(value.residentLabel),
    joinedMonth: String(value.joinedMonth ?? ''),
    publicBio: String(value.publicBio ?? ''),
    publicActivityCount: nonNegativeCount(value.publicActivityCount)
  };
}
