import { authenticatedFetch } from './auth-fetch';

export type HouseholdMember = {
  membershipId: string;
  displayName: string;
  membershipRole: 'primary' | 'member' | string;
  status: 'pending' | 'verified' | string;
  residentVerified: boolean;
};
export type HouseholdInvite = {
  inviteId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
export type HouseholdSnapshot = {
  complexSlug: string;
  myMembership: HouseholdMember;
  members: HouseholdMember[];
  invites: HouseholdInvite[];
};
export type HouseholdInviteCreated = {
  inviteId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
};
export type HouseholdInviteRedeemed = {
  membershipId: string;
  membershipRole: string;
  status: string;
  complexSlug: string;
  residentVerified: boolean;
  verificationRequired: boolean;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';
const MOCK_PRIMARY_ID = '00000000-0000-4000-8000-000000000311';
const MOCK_MEMBER_ID = '00000000-0000-4000-8000-000000000312';

type ApiEnvelope<T> = { data: T; requestId?: string };
let mockSnapshot: HouseholdSnapshot = {
  complexSlug: COMPLEX_SLUG,
  myMembership: { membershipId: MOCK_PRIMARY_ID, displayName: '나의 단지온', membershipRole: 'primary', status: 'verified', residentVerified: true },
  members: [
    { membershipId: MOCK_PRIMARY_ID, displayName: '나의 단지온', membershipRole: 'primary', status: 'verified', residentVerified: true },
    { membershipId: MOCK_MEMBER_ID, displayName: '가족 구성원', membershipRole: 'member', status: 'verified', residentVerified: true }
  ],
  invites: []
};

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}
function mapMember(raw: unknown): HouseholdMember {
  const value = row(raw);
  return {
    membershipId: String(value.membershipId ?? ''),
    displayName: String(value.displayName ?? ''),
    membershipRole: String(value.membershipRole ?? 'member'),
    status: String(value.status ?? 'pending'),
    residentVerified: value.residentVerified === true
  };
}
function mapSnapshot(raw: unknown): HouseholdSnapshot {
  const value = row(raw);
  return {
    complexSlug: String(value.complexSlug ?? COMPLEX_SLUG),
    myMembership: mapMember(value.myMembership),
    members: Array.isArray(value.members) ? value.members.map(mapMember) : [],
    invites: Array.isArray(value.invites) ? value.invites.map((item) => {
      const invite = row(item);
      return {
        inviteId: String(invite.inviteId ?? ''),
        status: String(invite.status ?? ''),
        createdAt: String(invite.createdAt ?? ''),
        expiresAt: String(invite.expiresAt ?? ''),
        acceptedAt: invite.acceptedAt == null ? null : String(invite.acceptedAt),
        revokedAt: invite.revokedAt == null ? null : String(invite.revokedAt)
      };
    }) : []
  };
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Household API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}
function householdPath(): string {
  return `/api/v1/complexes/${encodeURIComponent(COMPLEX_SLUG)}/household`;
}

export const householdFamilyClient = {
  async getSnapshot(): Promise<HouseholdSnapshot> {
    if (!API_MODE) return structuredClone(mockSnapshot);
    return mapSnapshot(await request<unknown>(householdPath()));
  },

  async createInvite(expiresInHours = 24): Promise<HouseholdInviteCreated> {
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) throw new Error('초대 유효시간은 1~168시간이어야 합니다.');
    if (!API_MODE) {
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
      const inviteId = crypto.randomUUID();
      const token = `demo_${crypto.randomUUID().replaceAll('-', '')}`;
      mockSnapshot = { ...mockSnapshot, invites: [{ inviteId, status: 'pending', createdAt, expiresAt, acceptedAt: null, revokedAt: null }, ...mockSnapshot.invites] };
      return { inviteId, token, createdAt, expiresAt };
    }
    const data = row(await request<unknown>(`${householdPath()}/family-invites`, {
      method: 'POST', body: JSON.stringify({ expiresInHours })
    }));
    return { inviteId: String(data.inviteId ?? ''), token: String(data.token ?? ''), createdAt: String(data.createdAt ?? ''), expiresAt: String(data.expiresAt ?? '') };
  },

  async revokeInvite(inviteId: string): Promise<void> {
    if (!API_MODE) {
      mockSnapshot = { ...mockSnapshot, invites: mockSnapshot.invites.map((item) => item.inviteId === inviteId ? { ...item, status: 'revoked', revokedAt: new Date().toISOString() } : item) };
      return;
    }
    await request(`${householdPath()}/family-invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
  },

  async redeemInvite(token: string): Promise<HouseholdInviteRedeemed> {
    const clean = token.trim();
    if (!clean) throw new Error('가족 초대 토큰을 입력해 주세요.');
    if (!API_MODE) {
      return { membershipId: crypto.randomUUID(), membershipRole: 'member', status: 'pending', complexSlug: COMPLEX_SLUG, residentVerified: false, verificationRequired: true };
    }
    const data = row(await request<unknown>('/api/v1/household/family-invites/redeem', {
      method: 'POST', body: JSON.stringify({ token: clean })
    }));
    return {
      membershipId: String(data.membershipId ?? ''), membershipRole: String(data.membershipRole ?? 'member'), status: String(data.status ?? 'pending'),
      complexSlug: String(data.complexSlug ?? ''), residentVerified: data.residentVerified === true, verificationRequired: data.verificationRequired === true
    };
  },

  async leave(): Promise<void> {
    if (!API_MODE) {
      mockSnapshot = { ...mockSnapshot, myMembership: { ...mockSnapshot.myMembership, status: 'revoked', residentVerified: false } };
      return;
    }
    await request(`${householdPath()}/members/me`, { method: 'DELETE' });
  },

  async revokeMember(membershipId: string): Promise<void> {
    if (!API_MODE) {
      mockSnapshot = { ...mockSnapshot, members: mockSnapshot.members.filter((item) => item.membershipId !== membershipId) };
      return;
    }
    await request(`${householdPath()}/members/${encodeURIComponent(membershipId)}`, { method: 'DELETE' });
  }
};
