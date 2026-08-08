import { useEffect, useMemo, useState } from 'react';
import {
  approveOperationsApplication,
  countPublishedBusinesses,
  getOperationsReviewContext,
  type OperationsReviewContext
} from './operations-review-api';

const relationLabels: Record<string, string> = {
  resident: '현재 단지 주민 직접 운영',
  resident_family: '현재 단지 주민 가족 운영',
  neighbor: '이웃 단지 주민 운영',
  local: '일반 동네 제휴가게'
};

const verificationLabels: Record<string, string> = {
  verified: '입주민 확인 완료',
  pending: '입주민 확인 대기',
  rejected: '입주민 확인 반려',
  suspended: '입주민 확인 중지',
  not_required: '별도 입주민 확인 대상 아님'
};

function statusLabel(status: string) {
  return {
    draft: '작성 중',
    pending: '확인 대기',
    changes_requested: '보완 요청',
    approved: '승인·공개',
    rejected: '반려'
  }[status] || status;
}

export default function OperationsReviewPage() {
  const applicationId = useMemo(() => new URLSearchParams(window.location.search).get('application')?.trim() || '', []);
  const [context, setContext] = useState<OperationsReviewContext | null>(null);
  const [beforeCount, setBeforeCount] = useState<number | null>(null);
  const [afterCount, setAfterCount] = useState<number | null>(null);
  const [note, setNote] = useState('공개 정보와 주민 관계 확인자료를 확인했습니다.');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    if (!applicationId) {
      setBusy(false);
      setMessage('검토할 신청 ID가 없습니다.');
      return () => { alive = false; };
    }
    Promise.all([
      getOperationsReviewContext(applicationId),
      countPublishedBusinesses()
    ]).then(([nextContext, count]) => {
      if (!alive) return;
      setContext(nextContext);
      setBeforeCount(count);
      if (!nextContext) setMessage('검토할 신청을 찾을 수 없습니다.');
    }).catch((error) => {
      if (!alive) return;
      setMessage(error instanceof Error ? error.message : '운영확인 정보를 불러오지 못했습니다.');
    }).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [applicationId]);

  async function approve() {
    if (!context || !['pending', 'changes_requested'].includes(context.status)) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await approveOperationsApplication(context.id, note.trim());
      setContext(result.context);
      setAfterCount(result.businesses.length);
      setMessage('승인하여 공개했습니다. 주민 목록에서 새 가게를 확인할 수 있습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '승인 처리에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (busy && !context) {
    return <main className="operations-review-shell"><div className="operations-loading">운영확인 정보를 불러오는 중입니다.</div></main>;
  }

  if (!context) {
    return <main className="operations-review-shell"><a className="review-back" href="/admin.html">← 운영관리로 돌아가기</a><div className="operations-empty" role="alert">{message || '검토할 신청이 없습니다.'}</div></main>;
  }

  const publicProfile = context.publicProfile;
  const privateVerification = context.privateVerification;
  const approved = context.status === 'approved';
  const publishedCount = afterCount ?? beforeCount;
  const residentUrl = `/?view=listings&businessName=${encodeURIComponent(publicProfile.businessName)}`;

  return (
    <main className="operations-review-shell">
      <header className="operations-review-header">
        <div>
          <span className="review-eyebrow">SCENE 07 · 운영확인</span>
          <h1>공개할 정보와<br />비공개 확인정보를 나눠 봅니다.</h1>
          <p>주민에게 보일 프로필과 운영자만 확인하는 주민 관계 자료를 분리해 검토합니다.</p>
        </div>
        <div className="review-header-actions">
          <a href="/admin.html">운영관리</a>
          <span className={`review-status status-${context.status}`}>{statusLabel(context.status)}</span>
        </div>
      </header>

      <section className="review-boundary-grid" aria-label="공개 및 비공개 운영확인">
        <article className="review-public-panel">
          <div className="review-panel-label"><span>주민에게 공개</span><b>PUBLIC PROFILE</b></div>
          <h2>{publicProfile.businessName}</h2>
          <p className="review-summary">{publicProfile.serviceSummary}</p>
          <dl className="review-data-list">
            <div><dt>분야</dt><dd>{publicProfile.categoryName || '미입력'}</dd></div>
            <div><dt>가격</dt><dd>{publicProfile.priceText || '상담 후 안내'}</dd></div>
            <div><dt>이용 지역</dt><dd>{publicProfile.serviceArea || '방림동과 인근 지역'}</dd></div>
            <div><dt>이용 시간</dt><dd>{publicProfile.availabilityText || '상담 후 안내'}</dd></div>
            <div><dt>주민혜택</dt><dd>{publicProfile.benefitText || '등록된 혜택 없음'}</dd></div>
          </dl>
          <div className="review-public-note">승인 후 이 정보가 주민의 가게·서비스 목록에 공개됩니다.</div>
        </article>

        <article className="review-private-panel">
          <div className="review-panel-label"><span>운영자만 확인</span><b>PRIVATE CHECK</b></div>
          <h2>주민 관계 확인</h2>
          <p className="review-summary">정확한 동·호수와 증빙 원문은 이 화면에 표시하지 않습니다.</p>
          <dl className="review-data-list private-data-list">
            <div><dt>신청자</dt><dd>{privateVerification.applicantName}</dd></div>
            <div><dt>주민 관계</dt><dd>{relationLabels[privateVerification.relationType] || privateVerification.relationType}</dd></div>
            <div><dt>입주민 확인 상태</dt><dd>{verificationLabels[privateVerification.membershipVerificationStatus] || privateVerification.membershipVerificationStatus}</dd></div>
            <div><dt>확인자료</dt><dd><strong>확인자료 {privateVerification.evidenceCount}건</strong></dd></div>
          </dl>
          <div className="privacy-shield" aria-label="민감정보 비공개 보호">
            <strong>민감정보 비공개</strong>
            <span>동·호수, 증빙 이미지, 원문 object key는 review-context 응답에 포함하지 않습니다.</span>
          </div>
        </article>
      </section>

      {!approved ? (
        <section className="review-decision-panel">
          <label htmlFor="operations-note">운영 검토 메모</label>
          <textarea id="operations-note" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} />
          <div className="review-decision-copy">
            <div><strong>공개 전 마지막 확인</strong><span>공개정보와 주민 관계 확인요약을 검토한 뒤 승인합니다.</span></div>
            <button type="button" className="approve-publish-button" onClick={() => void approve()} disabled={busy}>{busy ? '승인 처리 중...' : '승인하여 공개'}</button>
          </div>
        </section>
      ) : (
        <section className="review-approved-panel" aria-live="polite">
          <div>
            <span>승인 완료</span>
            <h2>{publicProfile.businessName}이 주민에게 공개됐습니다.</h2>
            <p>승인된 신청은 실제 가게 데이터로 전환되어 주민 목록에 다시 나타납니다.</p>
          </div>
          <div className="published-count" aria-label="공개 서비스 수">
            <small>공개 서비스</small>
            {beforeCount !== null && afterCount !== null && afterCount > beforeCount ? <strong>{beforeCount} → {afterCount}</strong> : <strong>{publishedCount ?? '-'}</strong>}
            <span>{beforeCount !== null && afterCount !== null && afterCount > beforeCount ? '+1 공개' : '현재 공개 수'}</span>
          </div>
          <a className="resident-reentry-link" href={residentUrl}>주민 공개목록에서 확인</a>
        </section>
      )}

      {message && <button className="review-toast" type="button" onClick={() => setMessage('')}>{message}</button>}
    </main>
  );
}
