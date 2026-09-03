import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  residentNewsClient,
  type ResidentNewsPost,
  type ResidentNewsSubmission,
  type ResidentNewsSubmissionStatus
} from '../../resident-news-client';
import './v2-resident-news.css';

type View = 'feed' | 'submit' | 'mine';

const STATUS_LABELS: Record<string, string> = {
  submitted: '접수됨',
  reviewing: '운영 확인 중',
  approved: '게시 승인',
  rejected: '게시하지 않음'
};

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusLabel(value: ResidentNewsSubmissionStatus): string {
  return STATUS_LABELS[value] || value;
}

export default function V2ResidentNewsPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('feed');
  const [posts, setPosts] = useState<ResidentNewsPost[]>([]);
  const [selected, setSelected] = useState<ResidentNewsPost | null>(null);
  const [submissions, setSubmissions] = useState<ResidentNewsSubmission[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
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

  async function loadFeed() {
    setBusy(true);
    setStatus('주민소식을 불러오는 중입니다.');
    try {
      setPosts(await residentNewsClient.listPosts());
      setStatus('');
    } catch (error) {
      setPosts([]);
      setStatus(error instanceof Error ? error.message : '주민소식을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function loadMine() {
    setBusy(true);
    setStatus('내 제보 상태를 확인하는 중입니다.');
    try {
      setSubmissions(await residentNewsClient.listOwnSubmissions());
      setStatus('');
    } catch (error) {
      setSubmissions([]);
      setStatus(error instanceof Error ? error.message : '내 제보 상태를 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function openFeed() {
    setOpen(true);
    setView('feed');
    setSelected(null);
    void loadFeed();
  }

  function openSubmit() {
    setOpen(true);
    setView('submit');
    setSelected(null);
    setStatus('');
  }

  function openMine() {
    setOpen(true);
    setView('mine');
    setSelected(null);
    void loadMine();
  }

  async function openDetail(postId: string) {
    setView('feed');
    setBusy(true);
    setStatus('주민소식을 확인하는 중입니다.');
    try {
      setSelected(await residentNewsClient.getPost(postId));
      setStatus('');
    } catch (error) {
      setSelected(null);
      setStatus(error instanceof Error ? error.message : '주민소식을 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function submitNews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('주민소식 제보를 접수하는 중입니다.');
    try {
      await residentNewsClient.submit({ title, body });
      setTitle('');
      setBody('');
      setView('mine');
      setSubmissions(await residentNewsClient.listOwnSubmissions());
      setStatus('제보가 접수되었습니다. 운영 확인 후 게시될 수 있습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '주민소식 제보를 접수하지 못했습니다.');
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
    <div className="v2-data-notice v2-resident-news-entry" data-v2-resident-news-entry>
      <strong>주민소식 · 주민 전용</strong>
      <p>주민이 전한 소식을 운영 확인 후 함께 봅니다. 주민확인 완료 계정만 이용할 수 있습니다.</p>
      <div className="v2-resident-news-actions">
        <button type="button" className="v2-btn v2-btn-small" onClick={openFeed}>주민소식 보기</button>
        <button type="button" className="v2-btn v2-btn-small" onClick={openSubmit}>소식 제보하기</button>
      </div>
    </div>,
    target
  ) : null;

  const dialog = open ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-resident-news-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="v2-dialog v2-resident-news-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-resident-news-title" data-v2-resident-news-dialog>
        <button type="button" className="v2-dialog-close" onClick={close}>닫기</button>
        <span className="v2-eyebrow">VERIFIED RESIDENT NEWS</span>
        <h2 id="v2-resident-news-title">주민소식</h2>
        <p className="v2-resident-news-boundary">주민소식은 주민 제보를 운영 확인한 뒤 게시하며, 주민확인 완료 계정에만 표시됩니다.</p>

        <nav className="v2-resident-news-tabs" aria-label="주민소식 메뉴">
          <button type="button" className="v2-btn v2-btn-small" aria-pressed={view === 'feed'} onClick={() => { setView('feed'); setSelected(null); void loadFeed(); }}>소식</button>
          <button type="button" className="v2-btn v2-btn-small" aria-pressed={view === 'submit'} onClick={() => { setView('submit'); setSelected(null); setStatus(''); }}>제보하기</button>
          <button type="button" className="v2-btn v2-btn-small" aria-pressed={view === 'mine'} onClick={() => { setView('mine'); setSelected(null); void loadMine(); }}>내 제보</button>
        </nav>

        {view === 'feed' && !selected && (
          <div data-v2-resident-news-list>
            {posts.map((post) => (
              <article key={post.id} data-v2-resident-news-item>
                <small>{dateLabel(post.publishedAt)}</small>
                <h3>{post.title}</h3>
                <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openDetail(post.id)}>내용 보기</button>
              </article>
            ))}
            {!busy && posts.length === 0 && !status && <p>현재 게시된 주민소식이 없습니다.</p>}
          </div>
        )}

        {view === 'feed' && selected && (
          <article data-v2-resident-news-detail>
            <small>{dateLabel(selected.publishedAt)}</small>
            <h3>{selected.title}</h3>
            <div className="v2-resident-news-body">{selected.body}</div>
            <button type="button" className="v2-btn v2-btn-small" onClick={() => { setSelected(null); setStatus(''); }}>목록으로</button>
          </article>
        )}

        {view === 'submit' && (
          <form className="v2-resident-news-form" data-v2-resident-news-form onSubmit={(event) => void submitNews(event)}>
            <label>
              제목
              <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required />
            </label>
            <label>
              내용
              <textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={7} required />
            </label>
            <p>제보 원문은 바로 공개되지 않습니다. 운영 확인 후 별도 게시본으로 주민에게 공개됩니다.</p>
            <button type="submit" className="v2-btn" disabled={busy}>제보 접수</button>
          </form>
        )}

        {view === 'mine' && (
          <div data-v2-resident-news-submissions>
            {submissions.map((item) => (
              <article key={item.id} data-v2-resident-news-submission data-status={item.status}>
                <div>
                  <small>{dateLabel(item.createdAt)} · {statusLabel(item.status)}</small>
                  <h3>{item.title}</h3>
                </div>
                {item.status === 'approved' && item.publishedPostId && (
                  <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openDetail(item.publishedPostId!)}>게시된 소식 보기</button>
                )}
              </article>
            ))}
            {!busy && submissions.length === 0 && !status && <p>아직 접수한 주민소식이 없습니다.</p>}
          </div>
        )}

        {status && <p role="status" data-v2-resident-news-status>{status}</p>}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{entry}{dialog}</>;
}
