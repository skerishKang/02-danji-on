import { useEffect, useState } from 'react';
import { adminVerificationAdapter } from './verification-api';
import type { ResidentVerificationState, ResidentVerificationStatus } from './verification-types';

const statusLabels: Record<ResidentVerificationStatus, string> = {
  unverified: '미인증',
  pending: '확인 대기',
  verified: '인증 완료',
  rejected: '반려'
};

export default function AdminVerificationApp() {
  const [items, setItems] = useState<ResidentVerificationState[]>([]);
  const [filter, setFilter] = useState<ResidentVerificationStatus | 'all'>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  async function load(status: ResidentVerificationStatus | 'all' = filter) {
    try {
      const rows = await adminVerificationAdapter.list(status);
      setItems(rows);
      setNotes(Object.fromEntries(rows.filter((row) => row.id).map((row) => [row.id as string, row.note || ''])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '입주민 인증 신청을 불러오지 못했습니다.');
    }
  }

  useEffect(() => { void load('pending'); }, []);

  async function changeFilter(value: ResidentVerificationStatus | 'all') {
    setFilter(value);
    await load(value);
  }

  async function review(item: ResidentVerificationState, status: 'verified' | 'rejected') {
    if (!item.id) return;
    setBusyId(item.id);
    setMessage('');
    try {
      await adminVerificationAdapter.review(item.id, { status, note: notes[item.id] || '' });
      setMessage(`${item.displayName}님의 입주민 인증을 '${statusLabels[status]}' 처리했습니다.`);
      await load(filter);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '입주민 인증 검토에 실패했습니다.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="verification-admin-shell">
      <header className="verification-admin-header">
        <div><span>DANJION OPERATIONS</span><h1>입주민 인증 관리</h1><p>방림명지로드힐 · 신청자의 동·호수와 인증 방식을 확인합니다.</p></div>
        <div className="verification-admin-links"><a href="/admin.html">운영관리</a><a href="/">주민 화면</a></div>
      </header>

      {message && <button className="verification-message" onClick={() => setMessage('')}>{message}</button>}

      <section className="verification-admin-toolbar">
        <div><h2>인증 신청</h2><p>승인해야 인증 주민 전용 연락처와 기능을 사용할 수 있습니다.</p></div>
        <select aria-label="입주민 인증 상태 필터" value={filter} onChange={(event) => void changeFilter(event.target.value as ResidentVerificationStatus | 'all')}>
          <option value="all">전체 상태</option><option value="pending">확인 대기</option><option value="verified">인증 완료</option><option value="rejected">반려</option><option value="unverified">미인증</option>
        </select>
      </section>

      <section className="verification-review-list">
        {items.map((item) => {
          const reviewable = item.status === 'pending' || item.status === 'rejected';
          return <article key={item.id || item.subject} className="verification-review-card">
            <div className="verification-review-top"><div><small>{item.subject}</small><h3>{item.displayName}</h3></div><span className={`verification-badge ${item.status}`}>{statusLabels[item.status]}</span></div>
            <dl><div><dt>동</dt><dd>{item.building || '-'}</dd></div><div><dt>호수</dt><dd>{item.unit || '-'}</dd></div><div><dt>인증 방식</dt><dd>{item.method || '-'}</dd></div><div><dt>증빙</dt><dd>{item.evidenceObjectKey ? '비공개 증빙 연결됨' : '없음'}</dd></div></dl>
            <label><span>검토 메모</span><textarea rows={2} value={item.id ? notes[item.id] || '' : ''} onChange={(event) => item.id && setNotes((current) => ({ ...current, [item.id as string]: event.target.value }))} disabled={!reviewable} /></label>
            <div className="verification-review-actions"><button className="reject" disabled={!reviewable || busyId === item.id} onClick={() => void review(item, 'rejected')}>반려</button><button className="approve" disabled={!reviewable || busyId === item.id} onClick={() => void review(item, 'verified')}>{busyId === item.id ? '처리 중...' : '인증 승인'}</button></div>
          </article>;
        })}
        {!items.length && <div className="verification-empty">조건에 맞는 인증 신청이 없습니다.</div>}
      </section>
    </main>
  );
}
