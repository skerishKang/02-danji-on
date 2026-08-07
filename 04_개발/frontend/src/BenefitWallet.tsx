import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataAdapter } from './api/adapter';
import { benefitClaimStatusLabels, type Benefit, type BenefitClaim } from './types';
import './benefit-wallet.css';

const CHANGE_EVENT = 'danjion:benefit-wallet-changed';

function useBenefitClaims() {
  const [claims, setClaims] = useState<BenefitClaim[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setClaims(await dataAdapter.listBenefitClaims());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const listener = () => void reload();
    window.addEventListener(CHANGE_EVENT, listener);
    return () => window.removeEventListener(CHANGE_EVENT, listener);
  }, [reload]);

  return { claims, loading, reload };
}

function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function claimFor(claims: BenefitClaim[], benefitId: string) {
  return claims.find((claim) => claim.benefitId === benefitId) ?? null;
}

function BenefitAction({ benefit, claim }: { benefit: Benefit; claim: BenefitClaim | null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function claimBenefit() {
    setBusy(true);
    setMessage('');
    try {
      const created = await dataAdapter.claimBenefit(benefit.id);
      setMessage(`혜택번호 ${created.code}를 내정보에 보관했습니다.`);
      notifyChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '주민혜택을 받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function markUsed() {
    setBusy(true);
    setMessage('');
    try {
      await dataAdapter.useBenefit(benefit.id);
      setMessage('주민혜택을 사용 완료로 처리했습니다.');
      notifyChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '혜택 상태를 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="benefit-action">
      {!claim && <button type="button" className="primary" disabled={busy} onClick={() => void claimBenefit()}>{busy ? '보관 중...' : '주민혜택 받기'}</button>}
      {claim?.status === 'stored' && <button type="button" className="primary" disabled={busy} onClick={() => void markUsed()}>{busy ? '처리 중...' : '사용 완료 처리'}</button>}
      {claim?.status === 'used' && <button type="button" className="secondary" disabled>사용 완료됨</button>}
      {claim && <span className={`benefit-claim-state ${claim.status}`}>{claim.code} · {benefitClaimStatusLabels[claim.status]}</span>}
      {message && <p className="benefit-action-message" role="status">{message}</p>}
    </div>
  );
}

export function BenefitCollection({ benefits, onOpenBusiness }: { benefits: Benefit[]; onOpenBusiness: (businessId: string) => void }) {
  const { claims, loading } = useBenefitClaims();
  const byBenefitId = useMemo(() => new Map(claims.map((claim) => [claim.benefitId, claim])), [claims]);

  return (
    <div className="benefit-wallet-grid" aria-busy={loading}>
      {benefits.map((benefit) => {
        const claim = byBenefitId.get(benefit.id) ?? null;
        return (
          <article className="benefit-wallet-card" key={benefit.id}>
            <div className="benefit-wallet-copy">
              <span>입주민 전용 혜택</span>
              <h3>{benefit.title}</h3>
              <button type="button" className="benefit-business-link" onClick={() => onOpenBusiness(benefit.businessId)}>{benefit.businessName}</button>
              <p>{benefit.description}</p>
              {benefit.conditions && <small>{benefit.conditions}</small>}
            </div>
            <BenefitAction benefit={benefit} claim={claim} />
          </article>
        );
      })}
    </div>
  );
}

export function DetailBenefitAction({ benefit }: { benefit: Benefit }) {
  const { claims, loading } = useBenefitClaims();
  const claim = claimFor(claims, benefit.id);
  return <div className="detail-benefit-wallet" aria-busy={loading}><BenefitAction benefit={benefit} claim={claim} /></div>;
}

export function MyBenefitWallet() {
  const { claims, loading } = useBenefitClaims();

  return (
    <section className="my-benefit-wallet" aria-busy={loading}>
      <div className="my-benefit-heading">
        <div><h2>받은 주민혜택</h2><p>받은 혜택번호와 사용 상태를 이곳에서 확인합니다.</p></div>
        <strong>{claims.length}</strong>
      </div>
      {claims.length ? (
        <div className="my-benefit-list">
          {claims.map((claim) => (
            <article key={claim.id} className={`my-benefit-item ${claim.status}`}>
              <div>
                <span>{claim.businessName}</span>
                <h3>{claim.title}</h3>
                <code>{claim.code}</code>
              </div>
              <div className="my-benefit-status">
                <b>{benefitClaimStatusLabels[claim.status]}</b>
                {claim.status === 'stored' ? (
                  <button type="button" onClick={async () => { await dataAdapter.useBenefit(claim.benefitId); notifyChange(); }}>사용 완료 처리</button>
                ) : <time>{claim.usedAt ? new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(claim.usedAt)) : ''}</time>}
              </div>
            </article>
          ))}
        </div>
      ) : <div className="benefit-wallet-empty">아직 받은 주민혜택이 없습니다.</div>}
    </section>
  );
}
