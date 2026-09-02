import { authenticatedFetch } from './auth-fetch';

export type ResidentConversation = {
  id: string;
  complexSlug: string;
  participant: { userId: string; nickname: string };
  latestMessage: { body: string; createdAt: string } | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ResidentMessage = {
  id: string;
  senderUserId: string;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type ResidentMessagePage = {
  conversationId: string;
  messages: ResidentMessage[];
};

export type StartConversationResult = {
  id: string;
  participantUserId: string;
  created: boolean;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const COMPLEX_SLUG = import.meta.env.VITE_COMPLEX_SLUG || 'bangnim-myeongji-roadhill';
const API_MODE = import.meta.env.VITE_DATA_MODE === 'api';
const MOCK_SELF_ID = '00000000-0000-4000-8000-000000000270';
const MOCK_PARTICIPANT_ID = '00000000-0000-4000-8000-000000000272';
const MOCK_CONVERSATION_ID = '00000000-0000-4000-8000-000000000273';

let mockConversations: ResidentConversation[] = [
  {
    id: MOCK_CONVERSATION_ID,
    complexSlug: COMPLEX_SLUG,
    participant: { userId: MOCK_PARTICIPANT_ID, nickname: '이웃 주민' },
    latestMessage: { body: '안녕하세요. 단지온 메시지입니다.', createdAt: '2026-09-02T12:00:00.000Z' },
    unreadCount: 1,
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z'
  }
];

const mockMessages = new Map<string, ResidentMessage[]>([
  [MOCK_CONVERSATION_ID, [
    {
      id: '00000000-0000-4000-8000-000000000281',
      senderUserId: MOCK_PARTICIPANT_ID,
      body: '안녕하세요. 단지온 메시지입니다.',
      createdAt: '2026-09-02T12:00:00.000Z',
      deletedAt: null
    }
  ]]
]);

type ApiEnvelope<T> = { data: T; requestId: string };

function row(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

function mapConversation(raw: unknown): ResidentConversation {
  const value = row(raw);
  const participant = row(value.participant);
  const latest = value.latestMessage ? row(value.latestMessage) : null;
  return {
    id: String(value.id ?? ''),
    complexSlug: String(value.complexSlug ?? ''),
    participant: { userId: String(participant.userId ?? ''), nickname: String(participant.nickname ?? '') },
    latestMessage: latest ? { body: String(latest.body ?? ''), createdAt: String(latest.createdAt ?? '') } : null,
    unreadCount: Math.max(0, Number(value.unreadCount ?? 0) || 0),
    createdAt: String(value.createdAt ?? ''),
    updatedAt: String(value.updatedAt ?? '')
  };
}

function mapMessage(raw: unknown): ResidentMessage {
  const value = row(raw);
  return {
    id: String(value.id ?? ''),
    senderUserId: String(value.senderUserId ?? ''),
    body: value.body == null ? null : String(value.body),
    createdAt: String(value.createdAt ?? ''),
    deletedAt: value.deletedAt == null ? null : String(value.deletedAt)
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
    throw new Error(message || `Message API request failed: ${response.status}`);
  }
  return (payload as ApiEnvelope<T>).data;
}

function mockConversation(id: string): ResidentConversation | null {
  return mockConversations.find((item) => item.id === id) ?? null;
}

export const residentMessagesClient = {
  async listConversations(): Promise<ResidentConversation[]> {
    if (!API_MODE) return structuredClone(mockConversations);
    const data = row(await request<unknown>('/api/v1/me/conversations'));
    return Array.isArray(data.conversations) ? data.conversations.map(mapConversation) : [];
  },

  async listMessages(conversationId: string): Promise<ResidentMessagePage> {
    if (!API_MODE) {
      if (!mockConversation(conversationId)) throw new Error('대화를 찾을 수 없습니다.');
      return { conversationId, messages: structuredClone(mockMessages.get(conversationId) ?? []) };
    }
    const data = row(await request<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`));
    return {
      conversationId: String(data.conversationId ?? conversationId),
      messages: Array.isArray(data.messages) ? data.messages.map(mapMessage) : []
    };
  },

  async sendMessage(conversationId: string, body: string): Promise<ResidentMessage> {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 2000) throw new Error('메시지는 1~2000자로 입력해 주세요.');
    if (!API_MODE) {
      const conversation = mockConversation(conversationId);
      if (!conversation) throw new Error('대화를 찾을 수 없습니다.');
      const createdAt = new Date().toISOString();
      const message: ResidentMessage = {
        id: crypto.randomUUID(),
        senderUserId: MOCK_SELF_ID,
        body: trimmed,
        createdAt,
        deletedAt: null
      };
      const list = mockMessages.get(conversationId) ?? [];
      mockMessages.set(conversationId, [...list, message]);
      mockConversations = mockConversations.map((item) => item.id === conversationId
        ? { ...item, latestMessage: { body: trimmed, createdAt }, unreadCount: 0, updatedAt: createdAt }
        : item);
      return structuredClone(message);
    }
    return mapMessage(await request<unknown>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: trimmed })
    }));
  },

  async markRead(conversationId: string): Promise<void> {
    if (!API_MODE) {
      if (!mockConversation(conversationId)) throw new Error('대화를 찾을 수 없습니다.');
      mockConversations = mockConversations.map((item) => item.id === conversationId ? { ...item, unreadCount: 0 } : item);
      return;
    }
    await request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });
  },

  async startConversation(participantUserId: string): Promise<StartConversationResult> {
    if (!API_MODE) {
      const existing = mockConversations.find((item) => item.participant.userId === participantUserId);
      if (existing) {
        return {
          id: existing.id,
          participantUserId,
          created: false,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt
        };
      }
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      mockConversations = [{
        id,
        complexSlug: COMPLEX_SLUG,
        participant: { userId: participantUserId, nickname: '인증 주민' },
        latestMessage: null,
        unreadCount: 0,
        createdAt: now,
        updatedAt: now
      }, ...mockConversations];
      mockMessages.set(id, []);
      return { id, participantUserId, created: true, createdAt: now, updatedAt: now };
    }
    const value = row(await request<unknown>('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ complexSlug: COMPLEX_SLUG, participantUserId })
    }));
    return {
      id: String(value.id ?? ''),
      participantUserId: String(value.participantUserId ?? participantUserId),
      created: value.created === true,
      createdAt: String(value.createdAt ?? ''),
      updatedAt: String(value.updatedAt ?? '')
    };
  }
};
