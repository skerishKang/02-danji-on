import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicComplexNewsClient } from '../../public-complex-news-client';
import type { ComplexNewsChannel, ComplexPost } from '../../types';
import './v2-complex-news.css';

const HUB_CHANNEL_TO_ENUM: Record<'official' | 'apartment', ComplexNewsChannel> = {
  official: 'danjion_notice',
  apartment: 'apartment_news'
};

const CHANNEL_LABELS: Record<ComplexNewsChannel, string> = {
  danjion_notice: '단지온공지',
  apartment_news: '아파트소식',
  management_office: '관리사무소',
  chair_greeting: '회장 인사말'
};

const CHANNEL_FILTERS: Array<{ value: ComplexNewsChannel | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'danjion_notice', label: '단지온공지' },
  { value: 'apartment_news', label: '아파트소식' },
  { value: 'management_office', label: '관리사무소' },
  { value: 'chair_greeting', label: '회장 인사말' }
];

function publishedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function V2ComplexNewsPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<ComplexPost[]>([]);
  const [selected, setSelected] = useState<ComplexPost | null>(null);
  const [activeChannel, setActiveChannel] = useState<ComplexNewsChannel | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('#v2-ending .v2-section-inner');
      setTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const openFromHub = (event: Event) => {
      const channel = (event as CustomEvent<{ channel?: unknown }>).detail?.channel;
      if (channel !== 'official' && channel !== 'apartment' && channel !== 'danjion_notice' && channel !== 'apartment_news' && channel !== 'management_office' && channel !== 'chair_greeting') return;
      const enumChannel = channel === 'official' || channel === 'apartment'
        ? HUB_CHANNEL_TO_ENUM[channel as 'official' | 'apartment']
        : channel as ComplexNewsChannel;
      void openList(enumChannel);
    };
    window.addEventListener('danjion:v2-open-complex-news', openFromHub);
    return () => window.removeEventListener('danjion:v2-open-complex-news', openFromHub);
  }, []);

  async function openList(channel: ComplexNewsChannel | 'all' = 'all') {
    setOpen(true);
    setSelected(null);
    setActiveChannel(channel);
    setBusy(true);
    setStatus('공식소식을 불러오는 중입니다.');
    try {
      setPosts(await publicComplexNewsClient.listPosts(channel === 'all' ? undefined : { channel }));
      setStatus('');
    } catch (error) {
      setPosts([]);
      setStatus(error instanceof Error ? error.message : '공식소식을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(postId: string) {
    setBusy(true);
    setStatus('공식소식을 확인하는 중입니다.');
    try {
      setSelected(await publicComplexNewsClient.getPost(postId));
      setStatus('');
    } catch (error) {
      setSelected(null);
      setStatus(error instanceof Error ? error.message : '공식소식을 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setSelected(null);
    setStatus('');
  }

  const entry = target ? createPortal(
    <div className="v2-data-notice" data-v2-complex-news-entry>
      <strong>단지 공식소식</strong>
      <p>관리사무소·입주자대표회의 등 공개된 단지 소식을 확인할 수 있습니다.</p>
      <button type="button" className="v2-btn v2-btn-small" onClick={() => void openList()}>공식소식 보기</button>
    </div>,
    target
  ) : null;

  const dialog = open ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-complex-news-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="v2-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-complex-news-title" data-v2-complex-news-dialog>
        <button type="button" className="v2-dialog-close" onClick={close}>닫기</button>
        <span className="v2-eyebrow">PUBLIC COMPLEX NEWS</span>
        <h2 id="v2-complex-news-title">단지 공식소식</h2>
        {!selected && (
          <div data-v2-complex-news-list>
            <div className="v2-complex-news-filters" role="group" aria-label="공식소식 채널 필터">
              {CHANNEL_FILTERS.map((filter) => (
                <button
                  type="button"
                  className={`v2-btn v2-btn-small${activeChannel === filter.value ? ' is-active' : ''}`}
                  disabled={busy}
                  aria-pressed={activeChannel === filter.value}
                  data-v2-complex-news-filter={filter.value}
                  key={filter.value}
                  onClick={() => void openList(filter.value)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            {posts.map((post) => (
              <article key={post.id} data-v2-complex-news-item>
                <small>{CHANNEL_LABELS[post.channel]} · {post.category} · {post.sourceName}</small>
                <h3>{post.title}</h3>
                <p>{publishedLabel(post.publishedAt)}</p>
                <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openDetail(post.id)}>내용 보기</button>
              </article>
            ))}
            {!busy && posts.length === 0 && !status && <p>현재 공개된 공식소식이 없습니다.</p>}
          </div>
        )}
        {selected && (
          <article data-v2-complex-news-detail>
            <small>{CHANNEL_LABELS[selected.channel]} · {selected.category} · {selected.sourceName}</small>
            <h3>{selected.title}</h3>
            <p>{publishedLabel(selected.publishedAt)}</p>
            <div>{selected.body}</div>
            <button type="button" className="v2-btn v2-btn-small" onClick={() => { setSelected(null); setStatus(''); }}>목록으로</button>
          </article>
        )}
        {status && <p role="status" data-v2-complex-news-status>{status}</p>}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{entry}{dialog}</>;
}
