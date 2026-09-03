import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  residentNewsClient,
  type ResidentNewsPost,
  type ResidentNewsSubmission
} from '../../resident-news-client';
import './v2-complex-news.css';

type View = 'feed' | 'submit' | 'mine';

function dateLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function statusLabel(status: string): string {
  return ({
    submitted: '접수됨',
    reviewing: '운영 확인 중',
    approved: '게시 완료',
    rejected: '게시하지 않음'
  } as Record<string, string>)[status] ?? status;
}

export default function V2ResidentNewsPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('feed');
  const [posts, setPosts] = useState<ResidentNewsPost[]>([]);
  const [selected, setSelected] = useState<ResidentNewsPost | null>(null);
  const [submissions, setSubmissions] = useState<ResidentNewsSubmission[]>([]);
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
    setView('feed');
    setSelected(null);
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

  async function openPortal() {
    setOpen(true);
    await loadFeed();
  }

  async function openDetail(postId: string) {
    setBusy(true);
    setStatus('주민소식을 확인하는 중입니다.');
    try {
      setSelected(await residentNewsClient.getPost(postId));
      setView('feed');
      setStatus('');
    } catch (error) {
      setSelected(null);
      setStatus(error instanceof Error ? error.message : '주민소식을 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function showMine() {
    setView('mine');
    setSelected(null);
    setBusy(true);
    setStatus('내 제보 상태를 확인하는 중입니다.');
    try {
      setSubmissions(await residentNewsClient.listOwnSubmissions());
      setStatus('');
    } catch (error) {
      setSubmissions([]);
      setStatus(error instanceof Error ? error.message : '내 제보 상태를 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function showSubmit() {
    setView('submit');
    setSelected(null);
    setStatus('');
  }

  async function submitNews(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    const body = String(data.get('body') ?? '').trim();
    if (!title || !body) {
      setStatus('제목과 내용을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('주민소식을 제보하는 중입니다.');
    try {
      await residentNewsClient.createSubmission({ title, body });
      form.reset();
      setStatus('제보가 접수되었습니다. 운영 확인 전에는 주민소식 피드에 게시되지 않습니다.');
      const rows = await residentNewsClient.listOwnSubmissions();
      setSubmissions(rows);
      setView('mine');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '주민소식을 제보하지 못했습니다.');
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
    <div className="v2-data-notice" data-v2-resident-news-entry>
      <strong>입주민 주민소식</strong>
      <p>입주민 제보는 운영 확인을 거쳐 주민전용 소식으로 게시됩니다.</p>
      <button type="button" className="v2-btn v2-btn-small" onClick={() => void openPortal()}>주민소식 보기</button>
    </div>,
    target
  ) : null;

  const dialog = open ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-resident-news-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="v2-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-resident-news-title" data-v2-resident-news-dialog>
        <button type="button" className="v2-dialog-close" onClick={close}>닫기</button>
        <span className="v2-eyebrow">VERIFIED RESIDENT NEWS</span>
        <h2 id="v2-resident-news-title">입주민 주민소식</h2>
        <p>공개 공식소식과 분리된 입주민 전용 소식입니다.</p>

        <div className="v2-dialog-actions" data-v2-resident-news-nav>
          <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void loadFeed()}>게시된 소식</button>
          <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={showSubmit}>소식 제보하기</button>
          <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void showMine()}>내 제보 상태</button>
        </div>

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
            <div>{selected.body}</div>
            <button type="button" className="v2-btn v2-btn-small" onClick={() => { setSelected(null); setStatus(''); }}>목록으로</button>
          </article>
        )}

        {view === 'submit' && (
          <form onSubmit={(event) => void submitNews(event)} data-v2-resident-news-submit>
            <label>
              제목
              <input name="title" maxLength={160} required disabled={busy} />
            </label>
            <label>
              내용
              <textarea name="body" maxLength={10000} required disabled={busy} />
            </label>
            <p>첨부파일은 현재 지원하지 않습니다. 제보 내용은 운영 확인 전 주민소식 피드에 노출되지 않습니다.</p>
            <button type="submit" className="v2-btn" disabled={busy}>제보 접수</button>
          </form>
        )}

        {view === 'mine' && (
          <div data-v2-resident-news-mine>
            {submissions.map((submission) => (
              <article key={submission.id} data-v2-resident-news-submission>
                <small>{dateLabel(submission.createdAt)}</small>
                <h3>{submission.title}</h3>
                <p>{statusLabel(submission.status)}</p>
                {submission.publishedPostId && (
                  <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openDetail(submission.publishedPostId!)}>게시본 보기</button>
                )}
              </article>
            ))}
            {!busy && submissions.length === 0 && !status && <p>접수한 주민소식 제보가 없습니다.</p>}
          </div>
        )}

        {status && <p role="status" data-v2-resident-news-status>{status}</p>}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{entry}{dialog}</>;
}
