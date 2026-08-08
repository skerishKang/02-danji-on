import { useEffect, useMemo, useState } from 'react';
import { dataAdapter } from './api/adapter';
import type { BenefitClaim, Business, BusinessApplication } from './types';

const cycle = ['발견', '혜택', '내 일 등록', '운영확인', '공개', '다시 발견'] as const;

type EndingState = {
  businesses: Business[];
  claims: BenefitClaim[];
  applications: BusinessApplication[];
};

export default function EndingPage() {
  const [state, setState] = useState<EndingState>({ businesses: [], claims: [], applications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const businessName = params.get('businessName')?.trim() || '';

  useEffect(() => {
    let alive = true;
    Promise.all([
      dataAdapter.listBusinesses(),
      dataAdapter.listBenefitClaims().catch(() => []),
      dataAdapter.listMyBusinessApplications().catch(() => [])
    ]).then(([businesses, claims, applications]) => {
      if (!alive) return;
      setState({ businesses, claims, applications });
    }).catch((reason) => {
      if (!alive) return;
      setError(reason instanceof Error ? reason.message : '생활경제 순환 상태를 불러오지 못했습니다.');
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const approvedApplications = state.applications.filter((application) => application.status === 'approved');
  const rediscovered = businessName
    ? state.businesses.some((business) => business.name === businessName)
    : approvedApplications.some((application) => state.businesses.some((business) => business.id === application.approvedBusinessId));

  return (
    <main className="cycle-ending">
      <section className="ending-hero" aria-labelledby="ending-title">
        <a className="ending-wordmark" href="/">단지온</a>
        <p className="ending-eyebrow">LIVING NEIGHBOR ECONOMY · FIELD DEMO</p>
        <h1 id="ending-title">우리 단지의 소비가<br />우리 이웃의 일로 이어집니다.</h1>
        <p className="ending-lead">필요한 일을 가까운 이웃에게서 발견하고, 주민혜택을 이용하고, 내 일도 알린 뒤 운영확인을 거쳐 다시 주민에게 공개되는 순환입니다.</p>
        {businessName && rediscovered && <p className="ending-rediscovered"><strong>{businessName}</strong>이 승인 후 주민 공개목록에서 다시 발견됐습니다.</p>}
        {error && <p className="ending-error" role="alert">{error}</p>}
      </section>

      <section className="cycle-track" aria-label="단지온 생활경제 순환">
        {cycle.map((label, index) => (
          <div className="cycle-step" key={label}>
            <span className="cycle-number">{String(index + 1).padStart(2, '0')}</span>
            <strong>{label}</strong>
            <span className="cycle-line" aria-hidden="true" />
          </div>
        ))}
      </section>

      <section className="ending-metrics" aria-label="현장시연 상태 지표">
        <article>
          <span>공개 가게·서비스</span>
          <strong>{loading ? '—' : `${state.businesses.length}개`}</strong>
          <small>시연용 예시</small>
        </article>
        <article>
          <span>보관·사용 주민혜택</span>
          <strong>{loading ? '—' : `${state.claims.length}건`}</strong>
          <small>시연용 예시</small>
        </article>
        <article>
          <span>승인된 내 일</span>
          <strong>{loading ? '—' : `${approvedApplications.length}건`}</strong>
          <small>시연용 예시</small>
        </article>
      </section>

      <section className="ending-actions">
        <a className="ending-primary" href="/?view=listings">다시 이웃가게 보기</a>
        <a className="ending-secondary" href="/">처음부터 다시 보기</a>
      </section>

      <footer className="ending-footer">
        <span>방림명지로드힐 현장시연</span>
        <span>모든 수치와 상태는 시연용 예시입니다.</span>
      </footer>
    </main>
  );
}
