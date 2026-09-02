import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { dataAdapter } from '../../api/adapter';

type ShareTarget = {
  element: HTMLElement;
  businessId: string;
};

function collectTargets(): ShareTarget[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.v2-integrated-shop-card[data-shop-id]'))
    .map((element) => ({ element, businessId: element.dataset.shopId || '' }))
    .filter((target) => target.businessId.length > 0);
}

function sameTargets(left: ShareTarget[], right: ShareTarget[]): boolean {
  return left.length === right.length && left.every((item, index) => (
    item.element === right[index]?.element && item.businessId === right[index]?.businessId
  ));
}

function findCardByBusinessId(businessId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('.v2-integrated-shop-card[data-shop-id]'))
    .find((element) => element.dataset.shopId === businessId) ?? null;
}

function waitForCard(businessId: string, timeoutMs = 7000): Promise<HTMLElement | null> {
  const existing = findCardByBusinessId(businessId);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const card = findCardByBusinessId(businessId);
      if (!card) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(card);
    });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function detailButton(card: HTMLElement): HTMLButtonElement | null {
  return Array.from(card.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.trim() === '상세보기') ?? null;
}

function buildShareUrl(shareSlug: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('shop', shareSlug);
  url.searchParams.delete('businessName');
  url.searchParams.delete('view');
  return url.toString();
}

function ShareAction({ businessId, onStatus }: { businessId: string; onStatus: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  async function createShareLink() {
    if (busy) return;
    setBusy(true);
    setShareUrl('');
    try {
      const reference = await dataAdapter.getBusinessShare(businessId);
      const url = buildShareUrl(reference.shareSlug);
      setShareUrl(url);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(url);
        onStatus('공유 링크를 복사했습니다.');
      } catch {
        onStatus('공유 링크를 만들었습니다. 아래 링크를 열거나 복사할 수 있습니다.');
      }
    } catch (cause) {
      onStatus(cause instanceof Error ? cause.message : '공유 링크를 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-v2-share-action data-business-id={businessId}>
      <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void createShareLink()}>
        {busy ? '공유 링크 만드는 중…' : '공유 링크 복사'}
      </button>
      {shareUrl && <a className="v2-btn v2-btn-small" href={shareUrl}>공유 링크 열기</a>}
    </div>
  );
}

export default function V2BusinessShareIntegration() {
  const [targets, setTargets] = useState<ShareTarget[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const sync = () => {
      const next = collectTargets();
      setTargets((current) => sameTargets(current, next) ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const shareSlug = new URL(window.location.href).searchParams.get('shop')?.trim();
    if (!shareSlug) return;

    let cancelled = false;
    async function reopenSharedBusiness() {
      setStatus('공유 가게를 찾는 중입니다.');
      try {
        const reference = await dataAdapter.resolveBusinessShare(shareSlug!);
        if (cancelled) return;
        const card = await waitForCard(reference.businessId);
        if (cancelled) return;
        const open = card ? detailButton(card) : null;
        if (!open) throw new Error('공유 링크의 가게가 현재 공개 목록에 없습니다.');
        card?.scrollIntoView({ block: 'center' });
        open.click();
        setStatus('');
      } catch {
        if (!cancelled) setStatus('공유 링크의 가게를 찾을 수 없습니다.');
      }
    }
    void reopenSharedBusiness();
    return () => { cancelled = true; };
  }, []);

  const portals = useMemo(() => targets.map((target) => {
    const copy = target.element.querySelector<HTMLElement>('.v2-integrated-shop-copy') ?? target.element;
    return createPortal(
      <ShareAction key={target.businessId} businessId={target.businessId} onStatus={setStatus} />,
      copy,
      `share-${target.businessId}`
    );
  }), [targets]);

  return (
    <>
      {portals}
      {status && <div className="v2-integration-toast" role="status" data-v2-share-status>{status}</div>}
    </>
  );
}
