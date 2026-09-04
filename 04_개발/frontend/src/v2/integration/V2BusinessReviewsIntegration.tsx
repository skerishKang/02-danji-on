import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { dataAdapter } from '../../api/adapter';
import { businessReviewsClient, type BusinessReview } from '../../business-reviews-client';

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR');
}

function businessIdFromClick(event: Event): string | null {
  const target = event.target instanceof Element ? event.target : null;
  const card = target?.closest<HTMLElement>('.v2-integrated-shop-card[data-shop-id]');
  return card?.dataset.shopId?.trim() || null;
}

export default function V2BusinessReviewsIntegration() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [detailTarget, setDetailTarget] = useState<HTMLElement | null>(null);
  const [reviews, setReviews] = useState<BusinessReview[]>([]);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewEditDrafts, setReviewEditDrafts] = useState<Record<string, string>>({});
  const [ownerReplyDrafts, setOwnerReplyDrafts] = useState<Record<string, string>>({});
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async (id: string) => {
    setBusy(true);
    setStatus('후기를 불러오는 중입니다.');
    try {
      const rows = await businessReviewsClient.list(id);
      setReviews(rows);
      setReviewEditDrafts(Object.fromEntries(rows.filter((review) => review.isMine).map((review) => [review.id, review.body])));
      setOwnerReplyDrafts(Object.fromEntries(rows.map((review) => [review.id, review.reply?.body ?? ''])));
      setStatus('');
    } catch {
      setReviews([]);
      setReviewEditDrafts({});
      setStatus('입주민 인증 후 이 가게의 후기를 확인할 수 있습니다.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onClick = (event: Event) => {
      const id = businessIdFromClick(event);
      if (id) setBusinessId(id);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    const sync = () => {
      const dialog = document.querySelector<HTMLElement>('.v2-detail-dialog');
      const dialogBusinessId = dialog?.dataset.shopId?.trim();
      if (dialogBusinessId) setBusinessId(dialogBusinessId);
      const slot = dialog?.querySelector<HTMLElement>('[data-v2-business-reviews-slot]') ?? null;
      const next = slot ?? (dialog?.classList.contains('v2-008-shop-detail') ? null : dialog);
      setDetailTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!detailTarget || !businessId) return;
    void refresh(businessId);
    let cancelled = false;
    void dataAdapter.listMyBusinessApplications()
      .then((applications) => {
        if (cancelled) return;
        setIsOwner(applications.some((item) => item.status === 'approved' && item.approvedBusinessId === businessId));
      })
      .catch(() => { if (!cancelled) setIsOwner(false); });
    return () => { cancelled = true; };
  }, [businessId, detailTarget, refresh]);

  async function createReview(event: FormEvent) {
    event.preventDefault();
    if (!businessId || busy) return;
    const body = reviewBody.trim();
    if (!body || body.length > 2000) {
      setStatus('후기는 1~2000자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('후기를 등록하는 중입니다.');
    try {
      await businessReviewsClient.create(businessId, body);
      setReviewBody('');
      await refresh(businessId);
      setStatus('후기를 등록했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '후기를 등록하지 못했습니다.');
      setBusy(false);
    }
  }

  async function saveOwnReview(reviewId: string) {
    if (!businessId || busy) return;
    const review = reviews.find((item) => item.id === reviewId);
    if (!review?.isMine) return;
    const body = (reviewEditDrafts[reviewId] ?? '').trim();
    if (!body || body.length > 2000) {
      setStatus('후기는 1~2000자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('후기를 수정하는 중입니다.');
    try {
      await businessReviewsClient.update(businessId, reviewId, body);
      await refresh(businessId);
      setStatus('후기를 수정했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '후기를 수정하지 못했습니다.');
      setBusy(false);
    }
  }

  async function deleteOwnReview(reviewId: string) {
    if (!businessId || busy) return;
    const review = reviews.find((item) => item.id === reviewId);
    if (!review?.isMine) return;
    if (!window.confirm('이 후기를 삭제할까요?')) return;
    setBusy(true);
    setStatus('후기를 삭제하는 중입니다.');
    try {
      await businessReviewsClient.remove(businessId, reviewId);
      await refresh(businessId);
      setStatus('후기를 삭제했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '후기를 삭제하지 못했습니다.');
      setBusy(false);
    }
  }

  async function saveOwnerReply(reviewId: string) {
    if (!businessId || !isOwner || busy) return;
    const body = (ownerReplyDrafts[reviewId] ?? '').trim();
    if (!body || body.length > 2000) {
      setStatus('답글은 1~2000자로 입력해 주세요.');
      return;
    }
    setBusy(true);
    setStatus('사장님 답글을 저장하는 중입니다.');
    try {
      await businessReviewsClient.upsertOwnerReply(businessId, reviewId, body);
      await refresh(businessId);
      setStatus('사장님 답글을 저장했습니다.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '사장님 답글을 저장하지 못했습니다.');
      setBusy(false);
    }
  }

  if (!detailTarget || !businessId) return null;

  return createPortal(
    <section className="v2-profile-benefits" data-v2-business-reviews data-business-id={businessId} aria-labelledby="v2-business-reviews-title">
      <div className="v2-profile-section-heading">
        <h3 id="v2-business-reviews-title">입주민 후기</h3>
        <b>{reviews.length}개</b>
      </div>
      {reviews.map((review) => (
        <article key={review.id} data-v2-business-review data-review-owned={review.isMine ? 'true' : 'false'}>
          <div>
            <strong>{review.author.nickname}</strong>
            <small>{shortDate(review.createdAt)}</small>
            <p>{review.body}</p>
          </div>
          {review.isMine && (
            <div data-v2-own-review-editor>
              <label>
                내 후기 수정
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={reviewEditDrafts[review.id] ?? review.body}
                  disabled={busy}
                  onChange={(event) => setReviewEditDrafts((current) => ({ ...current, [review.id]: event.target.value }))}
                />
              </label>
              <div className="v2-dialog-actions">
                <button type="button" className="v2-btn v2-btn-small" disabled={busy || !(reviewEditDrafts[review.id] ?? '').trim()} onClick={() => void saveOwnReview(review.id)}>후기 수정</button>
                <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void deleteOwnReview(review.id)}>후기 삭제</button>
              </div>
            </div>
          )}
          {review.reply && (
            <blockquote data-v2-owner-reply>
              <strong>사장님 답글</strong>
              <p>{review.reply.body}</p>
            </blockquote>
          )}
          {isOwner && (
            <div data-v2-owner-reply-editor>
              <label>
                사장님 답글
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={ownerReplyDrafts[review.id] ?? ''}
                  disabled={busy}
                  onChange={(event) => setOwnerReplyDrafts((current) => ({ ...current, [review.id]: event.target.value }))}
                />
              </label>
              <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void saveOwnerReply(review.id)}>답글 저장</button>
            </div>
          )}
        </article>
      ))}
      {!busy && reviews.length === 0 && !status && <p>아직 등록된 후기가 없습니다.</p>}
      <form onSubmit={(event) => void createReview(event)} data-v2-business-review-form>
        <label>
          후기 남기기
          <textarea rows={3} maxLength={2000} value={reviewBody} disabled={busy} onChange={(event) => setReviewBody(event.target.value)} />
        </label>
        <div className="v2-dialog-actions">
          <span>{reviewBody.length} / 2000</span>
          <button type="submit" className="v2-btn v2-btn-small" disabled={busy || !reviewBody.trim()}>후기 등록</button>
        </div>
      </form>
      {status && <p role="status" data-v2-business-review-status>{status}</p>}
    </section>,
    detailTarget
  );
}
