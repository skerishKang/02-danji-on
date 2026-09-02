import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { publicComplexNewsClient } from '../../public-complex-news-client';
import type { ComplexPost } from '../../types';

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

  async function openList() {
    setOpen(true);
    setSelected(null);
    setBusy(true);
    setStatus('공식소식을 불러오는 중입니다.');
    try {
      setPosts(await publicComplexNewsClient.listPosts());
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
            {posts.map((post) => (
              <article key={post.id} data-v2-complex-news-item>
                <small>{post.category} · {post.sourceName}</small>
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
            <small>{selected.category} · {selected.sourceName}</small>
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
