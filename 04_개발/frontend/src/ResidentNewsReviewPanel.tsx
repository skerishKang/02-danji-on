import { useEffect, useState } from 'react';
import {
  residentNewsAdminClient,
  type AdminResidentNewsSubmission,
  type ResidentNewsReviewAction,
  type ResidentNewsReviewStatus
} from './resident-news-admin-client';

const statusLabels: Record<ResidentNewsReviewStatus, string> = {
  submitted: '접수',
  reviewing: '검토 중',
  approved: '승인·게시',
  rejected: '반려'
};

const statusTone: Record<ResidentNewsReviewStatus, string> = {
  submitted: 'pending',
  reviewing: 'changes_requested',
  approved: 'approved',
  rejected: 'rejected'
};

type PublicationDraft = { title: string; body: string };

function formatDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export default function ResidentNewsReviewPanel() {
  const [status, setStatus] = useState<ResidentNewsReviewStatus>('submitted');
  const [submissions, setSubmissions] = useState<AdminResidentNewsSubmission[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, PublicationDraft>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  async function load(nextStatus = status) {
    try {
      const rows = await residentNewsAdminClient.list(nextStatus);
      setSubmissions(rows);
      setNotes(Object.fromEntries(rows.map((row) => [row.id, row.reviewNote || ''])));
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, { title: row.title, body: row.body }])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '주민소식 검토 목록을 불러오지 못했습니다.');
    }
  }

  useEffect(() => {
    void load('submitted');
  }, []);

  async function changeStatus(nextStatus: ResidentNewsReviewStatus) {
    setStatus(nextStatus);
    setMessage('');
    await load(nextStatus);
  }

  async function mutate(submission: AdminResidentNewsSubmission, action: ResidentNewsReviewAction) {
    setBusyId(submission.id);
    setMessage('');
    try {
      const draft = drafts[submission.id] || { title: submission.title, body: submission.body };
      await residentNewsAdminClient.review(submission.id, {
        action,
        reviewNote: notes[submission.id] || '',
        ...(action === 'approve' && draft.title.trim() !== submission.title ? { publishedTitle: draft.title.trim() } : {}),
        ...(action === 'approve' && draft.body.trim() !== submission.body ? { publishedBody: draft.body.trim() } : {})
      });
      const actionLabel = action === 'reviewing' ? '검토 중으로 변경' : action === 'approve' ? '승인·게시' : '반려';
      setMessage(`'${submission.title}' 제보를 ${actionLabel}했습니다.`);
      await load(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '주민소식 검토 상태를 변경하지 못했습니다.');
    } finally {
      setBusyId('');
    }
  }

  const mutable = status === 'submitted' || status === 'reviewing';

  return (
    <main className="admin-section" data-resident-news-review-panel>
      <div className="admin-section-heading">
        <div>
          <h2>주민소식 검토</h2>
          <p>입주민 제보를 확인하고 검토 시작, 승인·게시 또는 반려를 처리합니다. 검토 메모는 운영자 화면에만 표시됩니다.</p>
        </div>
        <select aria-label="주민소식 검토 상태 필터" value={status} onChange={(event) => void changeStatus(event.target.value as ResidentNewsReviewStatus)}>
          <option value="submitted">접수</option>
          <option value="reviewing">검토 중</option>
          <option value="approved">승인·게시</option>
          <option value="rejected">반려</option>
        </select>
      </div>

      {message && <button className="admin-message" onClick={() => setMessage('')}>{message}</button>}

      <div className="admin-application-list">
        {submissions.map((submission) => {
          const draft = drafts[submission.id] || { title: submission.title, body: submission.body };
          return (
            <article key={submission.id} className="admin-application-card resident-news-review-card" data-resident-news-review-id={submission.id}>
              <div className="admin-card-top">
                <div>
                  <span>{submission.submitterNickname} · {formatDateTime(submission.createdAt)}</span>
                  <h3>{submission.title}</h3>
                  <b>입주민 제보</b>
                </div>
                <span className={`admin-status ${statusTone[submission.status]}`}>{statusLabels[submission.status]}</span>
              </div>

              <p className="admin-summary resident-news-original-body">{submission.body}</p>

              <label className="review-note">
                <span>운영자 검토 메모</span>
                <textarea
                  aria-label={`운영자 검토 메모 - ${submission.title}`}
                  value={notes[submission.id] || ''}
                  onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))}
                  rows={2}
                  maxLength={1000}
                  placeholder="검토 사유 또는 내부 메모"
                  disabled={!mutable}
                />
              </label>

              <div className="admin-form resident-news-publication" aria-label="승인 시 게시 문안">
                <label className="full">
                  <span>게시 제목</span>
                  <input
                    aria-label={`게시 제목 - ${submission.title}`}
                    value={draft.title}
                    onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: { ...draft, title: event.target.value } }))}
                    maxLength={160}
                    disabled={!mutable}
                  />
                </label>
                <label className="full">
                  <span>게시 내용</span>
                  <textarea
                    aria-label={`게시 내용 - ${submission.title}`}
                    value={draft.body}
                    onChange={(event) => setDrafts((current) => ({ ...current, [submission.id]: { ...draft, body: event.target.value } }))}
                    rows={5}
                    maxLength={10000}
                    disabled={!mutable}
                  />
                </label>
              </div>

              {submission.publishedPostId && <p className="resident-news-published-note">주민 전용 주민소식으로 게시 완료</p>}

              {mutable && (
                <div className="review-actions">
                  <button
                    disabled={busyId === submission.id || submission.status !== 'submitted'}
                    onClick={() => void mutate(submission, 'reviewing')}
                  >검토 시작</button>
                  <button
                    className="reject"
                    disabled={busyId === submission.id}
                    onClick={() => void mutate(submission, 'reject')}
                  >반려</button>
                  <button
                    className="approve"
                    disabled={busyId === submission.id || !draft.title.trim() || !draft.body.trim()}
                    onClick={() => void mutate(submission, 'approve')}
                  >{busyId === submission.id ? '처리 중...' : '승인·게시'}</button>
                </div>
              )}
            </article>
          );
        })}
        {!submissions.length && <div className="admin-empty">이 상태의 주민소식 제보가 없습니다.</div>}
      </div>
    </main>
  );
}
