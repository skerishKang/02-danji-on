import { authenticatedFetch } from './auth-fetch';

export type ResidentPublicProfile = {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  residentLabel: 'verified_resident' | string;
  joinedMonth: string;
  publicBio: string;
};

export type ResidentProfilePatch = {
  nickname?: string;
  avatarUrl?: string | null;
  publicBio?: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';
const MOCK_SELF_ID = '00000000-0000-4000-8000-000000000270';
const MOCK_OTHER_ID = '00000000-0000-4000-8000-000000000272';

type ApiEnvelope<T> = { data: T; requestId: string };

let mockSelf: ResidentPublicProfile = {
  userId: MOCK_SELF_ID,
  nickname: '나의 단지온',
  avatarUrl: null,
  residentLabel: 'verified_resident',
  joinedMonth: '2026-09',
  publicBio: '이웃과 필요한 정보를 나누는 주민입니다.'
};

const mockOthers = new Map<string, ResidentPublicProfile>([[MOCK_OTHER_ID, {
  userId: MOCK_OTHER_ID,
  nickname: '이웃 주민',
  avatarUrl: null,
  residentLabel: 'verified_resident',
  joinedMonth: '2026-08',
  publicBio: '반갑습니다. 우리 단지 생활정보를 함께 나눠요.'
}]]);

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function mapProfile(raw: unknown): ResidentPublicProfile {
  const value = row(raw);
  return {
    userId: String(value.userId ?? ''),
    nickname: String(value.nickname ?? ''),
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    residentLabel: String(value.residentLabel ?? 'verified_resident'),
    joinedMonth: String(value.joinedMonth ?? ''),
    publicBio: String(value.publicBio ?? '')
  };
}

async function request(path: string, init?: RequestInit): Promise<ResidentPublicProfile> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<unknown> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Resident profile API request failed: ${response.status}`);
  }
  return mapProfile((payload as ApiEnvelope<unknown>).data);
}

function query(): string {
  return `complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`;
}

export const residentProfileClient = {
  async getSelf(): Promise<ResidentPublicProfile> {
    if (!API_MODE) return structuredClone(mockSelf);
    return request(`/api/v1/me/profile?${query()}`);
  },

  async updateSelf(patch: ResidentProfilePatch): Promise<ResidentPublicProfile> {
    if (!API_MODE) {
      mockSelf = {
        ...mockSelf,
        ...(patch.nickname !== undefined ? { nickname: patch.nickname.trim() } : {}),
        ...(patch.publicBio !== undefined ? { publicBio: patch.publicBio.trim() } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {})
      };
      return structuredClone(mockSelf);
    }
    return request(`/api/v1/me/profile?${query()}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  },

  async getResident(userId: string): Promise<ResidentPublicProfile> {
    if (!API_MODE) {
      const profile = mockOthers.get(userId);
      if (!profile) throw new Error('프로필을 찾을 수 없습니다.');
      return structuredClone(profile);
    }
    return request(`/api/v1/profiles/${encodeURIComponent(userId)}?${query()}`);
  }
};
