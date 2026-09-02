import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { residentInquiriesClient, type ResidentInquiryDetail, type ResidentInquirySummary } from '../../resident-inquiries-client';

const STATUS_LABEL: Record<string, string> = {
  received: '접수됨',
  in_progress: '처리 중',
  answered: '답변 완료',
  closed: '종료'
};

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
}

export default function V2InquiriesPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<ResidentInquirySummary[]>([]);
  const [selected, setSelected] = useState<ResidentInquiryDetail | null>(null);
  const [inquiryType, setInquiryType] = useState('생활문의');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.v2-profile-dialog');
      setTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setItems(await residentInquiriesClient.list());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '문의 목록을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (target) void refresh();
  }, [target, refresh]);

  async function createInquiry(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('문의를 접수하는 중입니다.');
    try {
      const created = await residentInquiriesClient.create({ inquiryType, title, body });
      setTitle('');
      setBody('');
      setSelected(created);
      setItems(await residentInquiriesClient.list());
      setStatus('문의를 접수했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '문의를 접수하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function openInquiry(id: string) {
    setBusy(true);
    setStatus('문의를 불러오는 중입니다.');
    try {
      setSelected(await residentInquiriesClient.get(id));
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '문의를 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function closeInquiry() {
    if (!selected || selected.status !== 'answered' || busy) return;
    setBusy(true);
    try {
      const closed = await residentInquiriesClient.close(selected.id);
      setSelected(closed);
      setItems(await residentInquiriesClient.list());
      setStatus('답변 확인을 마치고 문의를 종료했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '문의를 종료하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const panel = target ? createPortal(
    <section className="v2-profile-benefits" data-v2-inquiries-panel aria-labelledby="v2-inquiries-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-inquiries-title">문의</h3>
        <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void refresh()}>새로고침</button>
      </div>
      <div data-v2-inquiry-list>
        {items.map((item) => (
          <article key={item.id} data-v2-inquiry-item>
            <div>
              <strong>{item.title}</strong>
              <span>{item.inquiryType} · {STATUS_LABEL[item.status] ?? item.status}</span>
              <small>{shortDate(item.createdAt)}</small>
            </div>
            <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void openInquiry(item.id)}>내용 보기</button>
          </article>
        ))}
        {!busy && items.length === 0 && <p>아직 접수한 문의가 없습니다.</p>}
      </div>
      <form onSubmit={(event) => void createInquiry(event)} data-v2-inquiry-form>
        <label>
          문의 유형
          <input value={inquiryType} maxLength={64} disabled={busy} onChange={(event) => setInquiryType(event.target.value)} />
        </label>
        <label>
          제목
          <input value={title} maxLength={160} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          내용
          <textarea value={body} maxLength={10000} rows={4} disabled={busy} onChange={(event) => setBody(event.target.value)} />
        </label>
        <p>사진 첨부는 운영 기준 확정 후 지원됩니다.</p>
        <button type="submit" className="v2-btn v2-btn-small" disabled={busy || !inquiryType.trim() || !title.trim() || !body.trim()}>문의 접수</button>
      </form>
      {status && <p role="status" data-v2-inquiry-status>{status}</p>}
    </section>,
    target
  ) : null;

  const detail = selected ? createPortal(
    <div className="v2-dialog-backdrop" data-v2-inquiry-backdrop onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="v2-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-inquiry-detail-title" data-v2-inquiry-dialog>
        <button type="button" className="v2-dialog-close" onClick={() => setSelected(null)}>닫기</button>
        <span className="v2-eyebrow">RESIDENT INQUIRY</span>
        <h2 id="v2-inquiry-detail-title">{selected.title}</h2>
        <p>{selected.inquiryType} · {STATUS_LABEL[selected.status] ?? selected.status}</p>
        <section>
          <h3>문의 내용</h3>
          <p>{selected.body}</p>
        </section>
        <section>
          <h3>답변</h3>
          <p>{selected.response || '아직 등록된 답변이 없습니다.'}</p>
        </section>
        {selected.status === 'answered' && (
          <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void closeInquiry()}>답변 확인 후 종료</button>
        )}
      </section>
    </div>,
    document.body
  ) : null;

  return <>{panel}{detail}</>;
}
