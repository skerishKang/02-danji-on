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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
    : date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function statusLabel(value: ResidentNewsSubmissionStatus): string {
  return STATUS_LABELS[value] || value;
}

function preview(body: string): string {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact.length > 118 ? `${compact.slice(0, 118)}…` : compact;
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

  useEffect(() => {
    const openFromNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: unknown; view?: unknown }>).detail;
      const postId = detail?.postId;
      if (typeof postId === 'string' && UUID_RE.test(postId)) {
        setOpen(true);
        setView('feed');
        setSelected(null);
        setStatus('');
        void openDetail(postId.toLowerCase());
        return;
      }
      if (detail?.view === 'feed') openFeed();
      if (detail?.view === 'submit') openSubmit();
    };
    window.addEventListener('danjion:v2-open-resident-news', openFromNotification);
    return () => window.removeEventListener('danjion:v2-open-resident-news', openFromNotification);
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
    setOpen(true);
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

  const screen = open ? createPortal(
    <section
      className="v2-resident-news-layer v2-resident-news-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="v2-resident-news-title"
      data-v2-resident-news-backdrop
      data-v2-resident-news-dialog
    >
      <header className="v2-resident-news-screen-head">
        <button type="button" className="v2-resident-news-back" onClick={selected ? () => { setSelected(null); setStatus(''); } : close}>
          ← {selected ? '주민소식' : '우리단지'}
        </button>
        <div className="v2-resident-news-screen-actions">
          <button type="button" onClick={openFeed} aria-pressed={view === 'feed' && !selected}>소식</button>
          <button type="button" onClick={openMine} aria-pressed={view === 'mine'}>내 제보</button>
          <button type="button" className="v2-resident-news-close" onClick={close} aria-label="주민소식 닫기">×</button>
        </div>
      </header>

      <div className="v2-resident-news-screen-body">
        {view === 'feed' && !selected && (
          <>
            <section className="v2-resident-news-intro">
              <div>
                <span className="v2-resident-news-eyebrow">주민이 전하는 우리 단지 이야기</span>
                <h1 id="v2-resident-news-title">주민소식</h1>
              </div>
              <p>주민이 직접 전한 소식입니다.</p>
            </section>

            <section className="v2-resident-news-feature" aria-label="주민소식 제보">
              <div className="v2-resident-news-submit-call">
                <span>RESIDENT STORY</span>
                <h2>우리 단지의<br />좋은 소식을<br />보내주세요.</h2>
                <p>제목과 내용을 보내주시면 운영진 확인 후 게시합니다.</p>
                <button type="button" onClick={openSubmit}>소식 제보하기 <b>→</b></button>
              </div>
              <div className="v2-resident-news-process">
                <span>게시 과정</span>
                <h3>제보부터 게시까지</h3>
                <ol>
                  <li><b>01</b><strong>내용 접수</strong></li>
                  <li><b>02</b><strong>운영진 확인</strong></li>
                  <li><b>03</b><strong>주민소식 게시</strong></li>
                </ol>
                <p>현재 제품 계약은 제목과 내용 접수를 지원하며, 게시 여부는 운영 확인 결과를 따릅니다.</p>
              </div>
            </section>

            <section className="v2-resident-news-feed-head">
              <div>
                <h2>최근 주민소식</h2>
                <p>운영진이 확인하고 게시한 우리 단지 주민의 이야기입니다.</p>
              </div>
              <span>최신순</span>
            </section>

            <div className="v2-resident-news-filter-note" aria-label="주민소식 분류">
              <button type="button" aria-pressed="true">전체</button>
              <span>분류값은 현재 API에 없으므로 임의로 추정하지 않습니다.</span>
            </div>

            <section className="v2-resident-news-stories" aria-label="주민소식 목록" data-v2-resident-news-list>
              {posts.map((post, index) => (
                <article key={post.id} className={index === 0 ? 'v2-resident-news-story is-featured' : 'v2-resident-news-story'} data-v2-resident-news-item>
                  <div className="v2-resident-news-story-meta">
                    <span>주민소식 · 확인 후 게시</span>
                    <time>{dateLabel(post.publishedAt || post.createdAt)}</time>
                  </div>
                  <h3>{post.title}</h3>
                  <p>{preview(post.body)}</p>
                  <button type="button" disabled={busy} onClick={() => void openDetail(post.id)}>소식 읽기 <b>→</b></button>
                </article>
              ))}
              {!busy && posts.length === 0 && !status && <p className="v2-resident-news-empty">현재 게시된 주민소식이 없습니다.</p>}
            </section>
          </>
        )}

        {view === 'feed' && selected && (
          <article className="v2-resident-news-article" data-v2-resident-news-detail>
            <header>
              <div className="v2-resident-news-article-meta">
                <span>주민소식</span><i /><span>운영진 확인 후 게시</span>
              </div>
              <h1 id="v2-resident-news-title">{selected.title}</h1>
              <div className="v2-resident-news-author-row">
                <div><span>✓</span><b>방림명지로드힐 주민 제보 기반 게시</b></div>
                <time>{dateLabel(selected.publishedAt || selected.createdAt)}</time>
              </div>
            </header>
            <div className="v2-resident-news-article-grid">
              <aside>
                <strong>게시 정보</strong>
                <dl>
                  <div><dt>공간</dt><dd>주민소식</dd></div>
                  <div><dt>게시 방식</dt><dd>운영진 확인 후 게시</dd></div>
                  <div><dt>공개 범위</dt><dd>주민 전용</dd></div>
                </dl>
                <p>원 제보자의 동·호 등 비공개 정보는 게시 화면에 표시하지 않습니다.</p>
              </aside>
              <div className="v2-resident-news-article-body">
                <h2>{selected.title}</h2>
                <div className="v2-resident-news-body">{selected.body}</div>
              </div>
            </div>
            <nav className="v2-resident-news-article-nav" aria-label="주민소식 이동">
              <button type="button" onClick={() => { setSelected(null); setStatus(''); }}><small>목록으로</small><b>주민소식 전체 보기</b></button>
            </nav>
          </article>
        )}

        {view === 'submit' && (
          <section className="v2-resident-news-submit-view">
            <div className="v2-resident-news-submit-intro">
              <span>운영진 확인 후 게시</span>
              <h1 id="v2-resident-news-title">알리고 싶은 내용을 보내주세요.</h1>
              <p>현재 제품은 제목과 내용만 접수합니다. 사진·자료·연락 이메일은 서버 계약에 없으므로 받지 않습니다.</p>
            </div>
            <div className="v2-resident-news-proof">
              <span>✓</span>
              <div><small>제보자 주민 확인</small><b>주민 전용 인증 경계를 사용합니다.</b></div>
              <p>가입 계정의 주민 권한은 서버에서 확인하며 비공개 세대정보를 게시글에 노출하지 않습니다.</p>
            </div>
            <form className="v2-resident-news-form" data-v2-resident-news-form onSubmit={(event) => void submitNews(event)}>
              <label>
                제목
                <input name="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="무슨 소식인지 한 줄로 적어주세요" required />
              </label>
              <label>
                알리고 싶은 내용
                <textarea name="body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={8} placeholder="언제, 어디서, 누구에게 필요한 소식인지 적어주세요." required />
              </label>
              <p>전화번호 등 공개되면 안 되는 개인정보는 적지 마세요. 제보 원문은 바로 공개되지 않습니다.</p>
              <button type="submit" disabled={busy}>제보 접수</button>
            </form>
          </section>
        )}

        {view === 'mine' && (
          <section className="v2-resident-news-mine">
            <span className="v2-resident-news-eyebrow">MY RESIDENT NEWS</span>
            <h1 id="v2-resident-news-title">내 제보</h1>
            <p>접수한 주민소식의 운영 확인 상태를 확인합니다.</p>
            <div data-v2-resident-news-submissions>
              {submissions.map((item) => (
                <article key={item.id} data-v2-resident-news-submission data-status={item.status}>
                  <div>
                    <small>{dateLabel(item.createdAt)} · {statusLabel(item.status)}</small>
                    <h3>{item.title}</h3>
                  </div>
                  {item.status === 'approved' && item.publishedPostId && (
                    <button type="button" disabled={busy} onClick={() => void openDetail(item.publishedPostId!)}>게시된 소식 보기</button>
                  )}
                </article>
              ))}
              {!busy && submissions.length === 0 && !status && <p>아직 접수한 주민소식이 없습니다.</p>}
            </div>
          </section>
        )}

        {status && <p className="v2-resident-news-status" role="status" data-v2-resident-news-status>{status}</p>}
      </div>
    </section>,
    document.body
  ) : null;

  return <>{entry}{screen}</>;
}
