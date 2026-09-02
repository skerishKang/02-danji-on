import { authenticatedFetch } from './auth-fetch';

export type ResidentConsentPreference = {
  enabled: boolean | null;
  policyVersion: string | null;
  recordedAt: string | null;
};

export type ResidentSettings = {
  publicProfileEnabled: boolean;
  serviceNotifications: ResidentConsentPreference;
  benefitMarketing: ResidentConsentPreference;
  fontSizeStorage: 'device';
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

let mockSettings: ResidentSettings = {
  publicProfileEnabled: true,
  serviceNotifications: { enabled: true, policyVersion: 'demo-service-v1', recordedAt: '2026-09-02T00:00:00.000Z' },
  benefitMarketing: { enabled: false, policyVersion: 'demo-benefit-v1', recordedAt: '2026-09-02T00:00:00.000Z' },
  fontSizeStorage: 'device'
};

type ApiEnvelope<T> = { data: T; requestId: string };

function mapConsentPreference(raw: unknown): ResidentConsentPreference {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
    policyVersion: typeof row.policyVersion === 'string' ? row.policyVersion : null,
    recordedAt: typeof row.recordedAt === 'string' ? row.recordedAt : null
  };
}

function mapSettings(raw: unknown): ResidentSettings {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    publicProfileEnabled: row.publicProfileEnabled !== false,
    serviceNotifications: mapConsentPreference(row.serviceNotifications),
    benefitMarketing: mapConsentPreference(row.benefitMarketing),
    fontSizeStorage: 'device'
  };
}

async function requestSettings(init?: RequestInit): Promise<ResidentSettings> {
  const query = `complexSlug=${encodeURIComponent(COMPLEX_SLUG)}`;
  const response = await authenticatedFetch(`${API_BASE}/api/v1/me/settings?${query}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<unknown> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Settings API request failed: ${response.status}`);
  }
  return mapSettings((payload as ApiEnvelope<unknown>).data);
}

export const residentSettingsClient = {
  async get(): Promise<ResidentSettings> {
    if (!API_MODE) return structuredClone(mockSettings);
    return requestSettings();
  },

  async setPublicProfileEnabled(enabled: boolean): Promise<ResidentSettings> {
    if (!API_MODE) {
      mockSettings = { ...mockSettings, publicProfileEnabled: enabled };
      return structuredClone(mockSettings);
    }
    return requestSettings({
      method: 'PATCH',
      body: JSON.stringify({ publicProfileEnabled: enabled })
    });
  }
};
