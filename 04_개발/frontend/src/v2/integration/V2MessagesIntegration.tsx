import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  residentMessagesClient,
  type ResidentConversation,
  type ResidentMessage
} from '../../resident-messages-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalConversationId(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_RE.test(text) ? text : null;
}

function shortTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function setConversationQuery(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set('conversation', conversationId);
  else url.searchParams.delete('conversation');
  window.history.replaceState(null, '', url);
}

export default function V2MessagesIntegration() {
  const [profileTarget, setProfileTarget] = useState<HTMLElement | null>(null);
  const [conversations, setConversations] = useState<ResidentConversation[]>([]);
  const [selected, setSelected] = useState<ResidentConversation | null>(null);
  const [messages, setMessages] = useState<ResidentMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, item) => sum + Math.max(0, item.unreadCount), 0),
    [conversations]
  );

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const rows = await residentMessagesClient.listConversations();
      setConversations(rows);
      return rows;
    } catch {
      setStatus('메시지함을 불러오지 못했습니다.');
      return [];
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  const openConversation = useCallback(async (rawId: unknown) => {
    const conversationId = canonicalConversationId(rawId);
    if (!conversationId) {
      setStatus('올바르지 않은 대화 링크입니다.');
      return;
    }
    setBusy(true);
    setStatus('대화를 불러오는 중입니다.');
    try {
      const rows = await residentMessagesClient.listConversations();
      const conversation = rows.find((item) => item.id.toLowerCase() === conversationId);
      if (!conversation) throw new Error('대화를 찾을 수 없습니다.');
      await residentMessagesClient.markRead(conversationId);
      const page = await residentMessagesClient.listMessages(conversationId);
      const refreshed = await residentMessagesClient.listConversations();
      setConversations(refreshed);
      setSelected(refreshed.find((item) => item.id.toLowerCase() === conversationId) ?? conversation);
      setMessages(page.messages);
      setDraft('');
      setConversationQuery(conversationId);
      setStatus('');
    } catch (error) {
      setSelected(null);
      setMessages([]);
      setConversationQuery(null);
      setStatus(error instanceof Error ? error.message : '대화를 열 수 없습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.v2-profile-dialog');
      setProfileTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!profileTarget) return;
    setStatus('');
    void loadInbox();
  }, [profileTarget, loadInbox]);

  useEffect(() => {
    const initial = canonicalConversationId(new URL(window.location.href).searchParams.get('conversation'));
    if (initial) void openConversation(initial);

    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: unknown }>).detail;
      void openConversation(detail?.conversationId);
    };
    window.addEventListener('danjion:v2-open-conversation', onOpen);
    return () => window.removeEventListener('danjion:v2-open-conversation', onOpen);
  }, [openConversation]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    const body = draft.trim();
    if (!body || body.length > 2000) {
      setStatus('메시지는 1~2000자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('메시지를 보내는 중입니다.');
    try {
      await residentMessagesClient.sendMessage(selected.id, body);
      const [page, rows] = await Promise.all([
        residentMessagesClient.listMessages(selected.id),
        residentMessagesClient.listConversations()
      ]);
      setMessages(page.messages);
      setConversations(rows);
      setSelected(rows.find((item) => item.id === selected.id) ?? selected);
      setDraft('');
      setStatus('메시지를 보냈습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '메시지를 보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function closeConversation() {
    setSelected(null);
    setMessages([]);
    setDraft('');
    setStatus('');
    setConversationQuery(null);
  }

  const inbox = profileTarget ? createPortal(
    <section className="v2-profile-benefits" data-v2-messages-panel aria-labelledby="v2-messages-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-messages-title">메시지</h3>
        <b data-v2-message-unread>{unreadTotal}개 안 읽음</b>
      </div>
      <button type="button" className="v2-btn v2-btn-small" disabled={loadingInbox || busy} onClick={() => void loadInbox()}>
        새로고침
      </button>
      {loadingInbox && conversations.length === 0 && <p>메시지함을 불러오는 중입니다.</p>}
      {!loadingInbox && conversations.length === 0 && <p>아직 대화가 없습니다.</p>}
      {conversations.map((conversation) => (
        <article key={conversation.id} data-v2-conversation-item data-unread={conversation.unreadCount}>
          <div>
            <strong>{conversation.participant.nickname}</strong>
            <span>{conversation.latestMessage ? conversation.latestMessage.body : '대화를 시작할 수 있습니다.'}</span>
            {conversation.latestMessage && <small>{shortTime(conversation.latestMessage.createdAt)}</small>}
          </div>
          <div>
            {conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}
            <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openConversation(conversation.id)}>
              대화 열기
            </button>
          </div>
        </article>
      ))}
      {status && !selected && <p role="status" data-v2-messages-status>{status}</p>}
    </section>,
    profileTarget
  ) : null;

  const dialog = selected ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-conversation-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) closeConversation(); }}>
      <section className="v2-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-conversation-title" data-v2-conversation-dialog>
        <button type="button" className="v2-dialog-close" onClick={closeConversation}>닫기</button>
        <span className="v2-eyebrow">RESIDENT MESSAGE</span>
        <h2 id="v2-conversation-title">{selected.participant.nickname}님과의 대화</h2>
        <div data-v2-message-thread aria-live="polite">
          {messages.length === 0 && <p>아직 메시지가 없습니다.</p>}
          {messages.map((message) => {
            const fromOther = message.senderUserId === selected.participant.userId;
            return (
              <article key={message.id} data-v2-message-row data-sender={fromOther ? 'other' : 'self'}>
                <strong>{fromOther ? selected.participant.nickname : '나'}</strong>
                <p>{message.body ?? '삭제된 메시지입니다.'}</p>
                <small>{shortTime(message.createdAt)}</small>
              </article>
            );
          })}
        </div>
        <form onSubmit={(event) => void send(event)} data-v2-message-compose>
          <label>
            메시지
            <textarea value={draft} maxLength={2000} rows={4} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <div className="v2-dialog-actions">
            <span>{draft.length} / 2000</span>
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !draft.trim()}>보내기</button>
          </div>
        </form>
        {status && <p role="status" data-v2-conversation-status>{status}</p>}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{inbox}{dialog}</>;
}
