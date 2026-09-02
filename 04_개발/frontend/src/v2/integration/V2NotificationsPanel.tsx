import { useEffect, useState } from 'react';
import {
  residentNotificationsClient,
  type ResidentNotification,
  type ResidentNotificationFeed
} from '../../resident-notifications-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function safeConversationId(item: ResidentNotification): string | null {
  if (item.resource?.type !== 'conversation') return null;
  return UUID_RE.test(item.resource.id) ? item.resource.id.toLowerCase() : null;
}

function openConversation(conversationId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('conversation', conversationId);
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new CustomEvent('danjion:v2-open-conversation', { detail: { conversationId } }));
}

export default function V2NotificationsPanel() {
  const [feed, setFeed] = useState<ResidentNotificationFeed | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [status, setStatus] = useState('');

  async function reload(cancelled?: () => boolean) {
    try {
      const next = await residentNotificationsClient.list();
      if (!cancelled?.()) setFeed(next);
      return next;
    } catch {
      if (!cancelled?.()) setStatus('알림을 불러오지 못했습니다.');
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    setStatus('알림을 불러오는 중입니다.');
    void reload(() => cancelled).then((next) => {
      if (!cancelled && next) setStatus('');
    });
    return () => { cancelled = true; };
  }, []);

  async function markRead(item: ResidentNotification, navigate = false) {
    if (busyId || busyAll) return;
    const conversationId = safeConversationId(item);
    setBusyId(item.id);
    setStatus('알림 상태를 저장하는 중입니다.');
    try {
      if (!item.readAt) await residentNotificationsClient.markRead(item.id);
      const next = await residentNotificationsClient.list();
      setFeed(next);
      setStatus('');
      if (navigate && conversationId) openConversation(conversationId);
    } catch {
      setStatus('알림 상태를 저장하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    if (!feed || busyId || busyAll || feed.unreadCount === 0) return;
    setBusyAll(true);
    setStatus('모든 알림을 읽음 처리하는 중입니다.');
    try {
      await residentNotificationsClient.markAllRead();
      setFeed(await residentNotificationsClient.list());
      setStatus('모든 알림을 읽음 처리했습니다.');
    } catch {
      setStatus('알림 상태를 저장하지 못했습니다.');
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <section className="v2-profile-benefits" data-v2-notifications-panel aria-labelledby="v2-notifications-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-notifications-title">알림</h3>
        {feed && <b data-v2-notification-unread>{feed.unreadCount}개 안 읽음</b>}
      </div>
      {feed && feed.unreadCount > 0 && (
        <button type="button" className="v2-btn v2-btn-small" disabled={busyAll || Boolean(busyId)} onClick={() => void markAllRead()}>
          모두 읽음
        </button>
      )}
      {!feed && <p>{status || '알림을 불러오는 중입니다.'}</p>}
      {feed && feed.notifications.length === 0 && <p>새 알림이 없습니다.</p>}
      {feed?.notifications.map((item) => {
        const conversationId = safeConversationId(item);
        return (
          <article key={item.id} data-v2-notification-item data-read={item.readAt ? 'true' : 'false'}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.actor?.nickname ? `${item.actor.nickname} · ` : ''}{timeLabel(item.createdAt)}</span>
            </div>
            <div>
              {!item.readAt && (
                <button type="button" className="v2-btn v2-btn-small" disabled={busyId === item.id || busyAll} onClick={() => void markRead(item)}>
                  읽음
                </button>
              )}
              {conversationId && (
                <button type="button" className="v2-btn v2-btn-small" disabled={busyId === item.id || busyAll} onClick={() => void markRead(item, true)}>
                  메시지함 열기
                </button>
              )}
            </div>
          </article>
        );
      })}
      {status && <p role="status" data-v2-notifications-status>{status}</p>}
    </section>
  );
}
