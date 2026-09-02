import { authenticatedFetch } from './auth-fetch';

export type ResidentNotificationResource = {
  type: string;
  id: string;
};

export type ResidentNotification = {
  id: string;
  type: string;
  title: string;
  actor: { userId: string; nickname: string | null } | null;
  resource: ResidentNotificationResource | null;
  readAt: string | null;
  createdAt: string;
};

export type ResidentNotificationFeed = {
  unreadCount: number;
  notifications: ResidentNotification[];
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';

let mockFeed: ResidentNotificationFeed = {
  unreadCount: 2,
  notifications: [
    {
      id: '00000000-0000-4000-8000-000000000271',
      type: 'message',
      title: '새 메시지가 도착했습니다',
      actor: { userId: '00000000-0000-4000-8000-000000000272', nickname: '이웃 주민' },
      resource: { type: 'conversation', id: '00000000-0000-4000-8000-000000000273' },
      readAt: null,
      createdAt: '2026-09-02T12:00:00.000Z'
    },
    {
      id: '00000000-0000-4000-8000-000000000274',
      type: 'service',
      title: '단지온 이용 안내가 업데이트되었습니다',
      actor: null,
      resource: null,
      readAt: null,
      createdAt: '2026-09-02T11:00:00.000Z'
    }
  ]
};

type ApiEnvelope<T> = { data: T; requestId: string };

function mapNotification(raw: unknown): ResidentNotification {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const actorRow = row.actor && typeof row.actor === 'object' ? row.actor as Record<string, unknown> : null;
  const resourceRow = row.resource && typeof row.resource === 'object' ? row.resource as Record<string, unknown> : null;
  return {
    id: String(row.id ?? ''),
    type: String(row.type ?? ''),
    title: String(row.title ?? ''),
    actor: actorRow ? {
      userId: String(actorRow.userId ?? ''),
      nickname: typeof actorRow.nickname === 'string' ? actorRow.nickname : null
    } : null,
    resource: resourceRow ? { type: String(resourceRow.type ?? ''), id: String(resourceRow.id ?? '') } : null,
    readAt: typeof row.readAt === 'string' ? row.readAt : null,
    createdAt: String(row.createdAt ?? '')
  };
}

function mapFeed(raw: unknown): ResidentNotificationFeed {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const notifications = Array.isArray(row.notifications) ? row.notifications.map(mapNotification) : [];
  return {
    unreadCount: Number.isFinite(Number(row.unreadCount)) ? Math.max(0, Number(row.unreadCount)) : notifications.filter((item) => !item.readAt).length,
    notifications
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  }, 'resident');
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in payload ? payload.error?.message : undefined;
    throw new Error(message || `Notification API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function recomputeMockFeed(notifications: ResidentNotification[]): ResidentNotificationFeed {
  return { unreadCount: notifications.filter((item) => !item.readAt).length, notifications };
}

export const residentNotificationsClient = {
  async list(): Promise<ResidentNotificationFeed> {
    if (!API_MODE) return structuredClone(mockFeed);
    return mapFeed(await request<unknown>('/api/v1/me/notifications'));
  },

  async markRead(id: string): Promise<void> {
    if (!API_MODE) {
      const now = new Date().toISOString();
      mockFeed = recomputeMockFeed(mockFeed.notifications.map((item) => item.id === id ? { ...item, readAt: item.readAt || now } : item));
      return;
    }
    await request(`/api/v1/me/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },

  async markAllRead(): Promise<void> {
    if (!API_MODE) {
      const now = new Date().toISOString();
      mockFeed = recomputeMockFeed(mockFeed.notifications.map((item) => ({ ...item, readAt: item.readAt || now })));
      return;
    }
    await request('/api/v1/me/notifications/read-all', { method: 'POST' });
  }
};
