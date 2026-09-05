import { useEffect, useState } from 'react';
import { dataAdapter } from '../../api/adapter';
import type { ActivityItem } from '../../types';

const ACTIVITY_LABEL: Record<ActivityItem['type'], string> = {
  post: '게시글',
  comment: '댓글',
  reply: '답글',
  reaction: '공감',
  review: '후기'
};

function activitySummary(item: ActivityItem): string {
  if (item.title) return item.title;
  if (item.status === 'hidden' || item.status === 'deleted') return '숨김 또는 삭제된 활동';
  return item.targetType === 'business' ? '가게 활동' : '커뮤니티 활동';
}

export default function V2ActivityPanel() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadFirstPage() {
      setLoading(true);
      setError('');
      try {
        const page = await dataAdapter.listMyActivity({ type: 'all', limit: 5 });
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '나의 활동을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadFirstPage();
    return () => { cancelled = true; };
  }, []);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const page = await dataAdapter.listMyActivity({ type: 'all', limit: 5, cursor: nextCursor });
      setItems((current) => {
        const seen = new Set(current.map((item) => `${item.type}:${item.id}`));
        return [...current, ...page.items.filter((item) => !seen.has(`${item.type}:${item.id}`))];
      });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '다음 활동을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="v2-profile-benefits v2-profile-activity" data-v2-profile-activity>
      <h3>나의 활동</h3>
      {items.map((item) => (
        <article key={`${item.type}:${item.id}`} data-activity-type={item.type}>
          <div>
            <strong>{ACTIVITY_LABEL[item.type]}</strong>
            <span>{activitySummary(item)}</span>
            {item.bodyPreview && <small>{item.bodyPreview}</small>}
          </div>
          <div><b>{item.status === 'deleted' ? '삭제됨' : item.status === 'hidden' ? '숨김' : '기록됨'}</b></div>
        </article>
      ))}
      {!loading && !error && !items.length && <p>아직 남긴 활동이 없습니다.</p>}
      {error && <div className="v2-data-notice" role="status">활동만 불러오지 못했습니다. {error}</div>}
      {loading && !items.length && <p role="status">나의 활동을 불러오는 중입니다.</p>}
      {nextCursor && <button type="button" className="v2-btn v2-btn-small" disabled={loading} onClick={() => void loadMore()}>{loading ? '불러오는 중…' : '활동 더 보기'}</button>}
    </div>
  );
}
