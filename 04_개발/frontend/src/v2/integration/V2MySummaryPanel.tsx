import { useEffect, useState } from 'react';
import { residentSummaryClient, type ResidentSummary } from '../../resident-summary-client';

function householdLabel(summary: ResidentSummary): string {
  const status = summary.household.status === 'verified' ? '인증 완료' : '확인 중';
  const role = summary.household.membershipRole === 'primary' ? '세대 대표' : '세대 구성원';
  return `${status} · ${role}`;
}

export default function V2MySummaryPanel() {
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      setLoading(true);
      setError('');
      try {
        const next = await residentSummaryClient.getSummary();
        if (!cancelled) setSummary(next);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '내 단지온 요약을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSummary();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="v2-profile-benefits v2-profile-summary" data-v2-my-summary>
      <h3>내 단지온 요약</h3>
      {summary && (
        <>
          <article data-summary-key="post"><div><strong>내 게시글</strong><span>현재 단지 커뮤니티</span></div><div><b>{summary.postCount}개</b></div></article>
          <article data-summary-key="comment"><div><strong>내 댓글·답글</strong><span>현재 단지 커뮤니티</span></div><div><b>{summary.commentCount}개</b></div></article>
          <article data-summary-key="reaction"><div><strong>받은 공감</strong><span>내 공개 게시글 기준</span></div><div><b>{summary.receivedReactionCount}개</b></div></article>
          <article data-summary-key="saved-business"><div><strong>저장한 가게</strong><span>현재 승인·확인된 가게</span></div><div><b>{summary.savedBusinessCount}개</b></div></article>
          <article data-summary-key="unread-message"><div><strong>읽지 않은 메시지</strong><span>주민 대화</span></div><div><b>{summary.unreadMessageCount}개</b></div></article>
          <article data-summary-key="household"><div><strong>세대 인증</strong><span>현재 단지 주민 자격</span></div><div><b>{householdLabel(summary)}</b></div></article>
        </>
      )}
      {loading && !summary && <p role="status">내 단지온 요약을 불러오는 중입니다.</p>}
      {error && <div className="v2-data-notice" role="status">요약만 불러오지 못했습니다. {error}</div>}
    </div>
  );
}
