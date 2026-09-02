import { authenticatedFetch } from './auth-fetch';

export const DANJION_ACCOUNT_CLOSE_CONFIRMATION = 'CLOSE_DANJION_ACCOUNT';

export type DanjiOnAccountCloseResult = {
  accountStatus: 'closed' | string;
  closedAt: string | null;
  authorizationRevoked: boolean;
  authProviderAccountDeleted: boolean;
  revoked: {
    householdMemberships: number;
    padiemGrants: number;
    complexGrants: number;
    inviteTokens: number;
    familyInvites: number;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

type ApiEnvelope<T> = { data: T; requestId?: string };
type ErrorEnvelope = { error?: { code?: string; message?: string } };

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function count(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function mapResult(raw: unknown): DanjiOnAccountCloseResult {
  const value = row(raw);
  const revoked = row(value.revoked);
  return {
    accountStatus: String(value.accountStatus ?? ''),
    closedAt: value.closedAt == null ? null : String(value.closedAt),
    authorizationRevoked: value.authorizationRevoked === true,
    authProviderAccountDeleted: value.authProviderAccountDeleted === true,
    revoked: {
      householdMemberships: count(revoked.householdMemberships),
      padiemGrants: count(revoked.padiemGrants),
      complexGrants: count(revoked.complexGrants),
      inviteTokens: count(revoked.inviteTokens),
      familyInvites: count(revoked.familyInvites)
    }
  };
}

async function requestClose(confirm: string): Promise<DanjiOnAccountCloseResult> {
  const response = await authenticatedFetch(`${API_BASE}/api/v1/me/account/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm })
  }, 'resident');
  let payload: ApiEnvelope<unknown> | ErrorEnvelope = {};
  try {
    payload = await response.json() as ApiEnvelope<unknown> | ErrorEnvelope;
  } catch {
    // Preserve the controlled HTTP error below if an intermediary returns no JSON.
  }
  if (!response.ok) {
    const error = 'error' in payload ? payload.error : undefined;
    throw new Error(error?.message || `Account close request failed: ${response.status}`);
  }
  return mapResult((payload as ApiEnvelope<unknown>).data);
}

export const residentAccountLifecycleClient = {
  async closeProductAccount(confirm: string): Promise<DanjiOnAccountCloseResult> {
    const clean = confirm.trim();
    if (clean !== DANJION_ACCOUNT_CLOSE_CONFIRMATION) {
      throw new Error('계정 종료 확인 문구를 정확히 입력해 주세요.');
    }
    if (!API_MODE) {
      return {
        accountStatus: 'closed',
        closedAt: new Date().toISOString(),
        authorizationRevoked: true,
        authProviderAccountDeleted: false,
        revoked: {
          householdMemberships: 1,
          padiemGrants: 0,
          complexGrants: 0,
          inviteTokens: 1,
          familyInvites: 1
        }
      };
    }
    return requestClose(clean);
  }
};
