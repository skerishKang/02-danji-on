(() => {
  'use strict';

  const MAX_MESSAGE_CHARS = 2000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // Display-only grouping for the 27 filters (official / reaction / message /
  // account). Server `type` stays the authority; unknown types fall back to
  // the official bucket and nothing is claimed about them.
  function notificationCategory(type) {
    const value = String(type || '').toLowerCase();
    if (value === 'message') return 'message';
    if (value === 'comment' || value === 'reaction') return 'reaction';
    if (value === 'inquiry_answer' || value === 'household_link') return 'account';
    return 'official';
  }

  function normalizeConversation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const participant = raw.participant && typeof raw.participant === 'object' ? raw.participant : {};
    const latest = raw.latestMessage && typeof raw.latestMessage === 'object' ? raw.latestMessage : null;
    const unread = Number(raw.unreadCount);
    return {
      id: String(raw.id || ''),
      complexSlug: String(raw.complexSlug || ''),
      participant: { userId: String(participant.userId || ''), nickname: String(participant.nickname || '') },
      latestMessage: latest ? { body: String(latest.body ?? ''), createdAt: latest.createdAt ?? null } : null,
      unreadCount: Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0,
      createdAt: raw.createdAt ?? null,
      updatedAt: raw.updatedAt ?? null
    };
  }

  function normalizeMessage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id: String(raw.id || ''),
      senderUserId: String(raw.senderUserId || ''),
      body: raw.body == null ? null : String(raw.body),
      createdAt: raw.createdAt ?? null,
      deletedAt: raw.deletedAt ?? null
    };
  }

  function normalizeNotification(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const actor = raw.actor && typeof raw.actor === 'object' ? raw.actor : null;
    const resource = raw.resource && typeof raw.resource === 'object' ? raw.resource : null;
    return {
      id: String(raw.id || ''),
      type: String(raw.type || ''),
      title: String(raw.title || ''),
      actor: actor ? { userId: String(actor.userId || ''), nickname: typeof actor.nickname === 'string' ? actor.nickname : null } : null,
      resource: resource ? { type: String(resource.type || ''), id: String(resource.id || '') } : null,
      readAt: raw.readAt ?? null,
      createdAt: raw.createdAt ?? null,
      category: notificationCategory(raw.type)
    };
  }

  function failureMode(result) {
    return result.reason === 'auth-required' ? 'auth-required' : 'error';
  }

  // Canonical apiBase/session semantics come from DanjionSession (#324).
  // This bridge never parses location.search itself and never persists state.
  function createMessagesNotificationsBridge(options = {}) {
    const session = globalThis.DanjionSession;
    if (!session || typeof session.createSessionFetch !== 'function') {
      throw new TypeError('DanjionSession canonical runtime is required');
    }
    const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    const apiBase = String(options.apiBase || '').replace(/\/+$/, '');
    const sessionFetch = session.createSessionFetch(apiBase);
    const request = (path, init) => sessionFetch(fetchImpl, path, init);

    function serverOnly() {
      return Boolean(apiBase);
    }

    return {
      // Canonical account identity from the existing /api/v1/me authority
      // (auth-v1 actor). Used only to mark which messages are mine.
      async getSelfId() {
        if (!serverOnly()) return { mode: 'static' };
        const result = await request('/api/v1/me');
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error };
        const user = result.data?.user && typeof result.data.user === 'object' ? result.data.user : {};
        return { mode: 'server', status: result.status, userId: String(user.id || '') };
      },

      async listConversations() {
        if (!serverOnly()) return { mode: 'static', conversations: [] };
        const result = await request('/api/v1/me/conversations');
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, conversations: [] };
        const rows = Array.isArray(result.data?.conversations) ? result.data.conversations : [];
        return { mode: 'server', status: result.status, conversations: rows.map(normalizeConversation).filter(Boolean) };
      },

      async listMessages(conversationId) {
        const id = String(conversationId || '').toLowerCase();
        if (!serverOnly()) return { mode: 'static', conversationId: id, messages: [] };
        if (!UUID.test(id)) return { mode: 'client', error: 'CONVERSATION_ID_INVALID', conversationId: id, messages: [] };
        const result = await request(`/api/v1/conversations/${encodeURIComponent(id)}/messages`);
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, conversationId: id, messages: [] };
        const rows = Array.isArray(result.data?.messages) ? result.data.messages : [];
        return { mode: 'server', status: result.status, conversationId: String(result.data?.conversationId || id), messages: rows.map(normalizeMessage).filter(Boolean) };
      },

      async sendMessage(conversationId, body) {
        const id = String(conversationId || '').toLowerCase();
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!UUID.test(id)) return { ok: false, mode: 'client', error: 'CONVERSATION_ID_INVALID' };
        const text = String(body || '').trim();
        if (!text || text.length > MAX_MESSAGE_CHARS) return { ok: false, mode: 'client', error: 'MESSAGE_BODY_INVALID' };
        const result = await request(`/api/v1/conversations/${encodeURIComponent(id)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: text })
        });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, message: normalizeMessage(result.data) };
      },

      async markConversationRead(conversationId) {
        const id = String(conversationId || '').toLowerCase();
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!UUID.test(id)) return { ok: false, mode: 'client', error: 'CONVERSATION_ID_INVALID' };
        const result = await request(`/api/v1/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, readAt: result.data?.readAt ?? null };
      },

      async listNotifications() {
        if (!serverOnly()) return { mode: 'static', unreadCount: 0, notifications: [] };
        const result = await request('/api/v1/me/notifications');
        if (!result.ok) return { mode: failureMode(result), status: result.status, error: result.error, unreadCount: 0, notifications: [] };
        const rows = Array.isArray(result.data?.notifications) ? result.data.notifications : [];
        const unread = Number(result.data?.unreadCount);
        return {
          mode: 'server',
          status: result.status,
          unreadCount: Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0,
          notifications: rows.map(normalizeNotification).filter(Boolean)
        };
      },

      async markNotificationRead(notificationId) {
        const id = String(notificationId || '').toLowerCase();
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        if (!UUID.test(id)) return { ok: false, mode: 'client', error: 'NOTIFICATION_ID_INVALID' };
        const result = await request(`/api/v1/me/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, readAt: result.data?.readAt ?? null };
      },

      async markAllNotificationsRead() {
        if (!serverOnly()) return { ok: false, mode: 'static', error: 'SERVER_MODE_REQUIRED' };
        const result = await request('/api/v1/me/notifications/read-all', { method: 'POST' });
        if (!result.ok) return { ok: false, mode: failureMode(result), status: result.status, error: result.error };
        return { ok: true, mode: 'server', status: result.status, updatedCount: Number(result.data?.updatedCount || 0) };
      }
    };
  }

  globalThis.DanjionMessagesNotificationsBridge = {
    createMessagesNotificationsBridge,
    notificationCategory,
    normalizeConversation,
    normalizeMessage,
    normalizeNotification
  };
})();
