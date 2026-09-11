import type { Benefit, BenefitClaim } from '../../types';
import { V2VisualImage, type V2ReferenceImage } from '../visual';
import { LOCAL_IMAGE_FALLBACK } from './v2-integration-data';
import { V2_API_DATA_MODE } from './v2-live-data';

export default function V2BenefitsSection({
  benefit,
  claim,
  image,
  claimState,
  busy,
  onClaim,
  onOpenProfile
}: {
  benefit: Benefit | null;
  claim: BenefitClaim | null;
  image: V2ReferenceImage;
  claimState: 'available' | 'stored' | 'used';
  busy: boolean;
  onClaim: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <section id="v2-benefits" data-v2-section="benefits" className="v2-integration-section v2-integrated-benefits">
      <div className="v2-section-inner v2-benefit-layout">
        <div className="v2-benefit-photo">
          <V2VisualImage src={image.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={benefit ? `${benefit.businessName} 주민혜택` : '주민혜택 예시'} fallbackLabel={benefit?.businessName ?? '주민혜택'} />
          <div className="v2-benefit-photo-copy"><div className="v2-eyebrow">SCENE 04 · 주민혜택</div><h2>혜택이<br />실제 행동이 됩니다.</h2><p>혜택을 받으면 내정보에서 번호와 사용 상태를 다시 확인할 수 있습니다.</p></div>
        </div>
        <div className="v2-benefit-panel">
          <div className="v2-benefit-card">
            <span className="v2-tag">방림명지로드힐 입주민 전용{V2_API_DATA_MODE ? '' : ' · 시연용 예시'}</span>
            <h3>{benefit?.businessName ?? '현재 연결된 주민혜택 없음'}</h3>
            <div className="v2-benefit-big">{benefit?.title ?? '입주민 인증 후 이용 가능한 혜택을 준비 중입니다.'}</div>
            {benefit?.description && <p>{benefit.description}</p>}
            {benefit?.conditions && <small>{benefit.conditions}</small>}
            <div className="v2-benefit-code"><span>혜택번호</span><strong>{claim?.code ?? '받기 전'}</strong></div>
            <div className="v2-benefit-status"><span className={`v2-status-dot v2-status-${claimState}`} /><span>{claimState === 'stored' ? '보관 중' : claimState === 'used' ? '사용 완료' : '아직 받지 않은 혜택'}</span></div>
            {claimState === 'available' && <button className="v2-btn v2-btn-accent" type="button" disabled={busy || !benefit} onClick={onClaim}>주민혜택 받기</button>}
            {claimState === 'stored' && <button className="v2-btn v2-btn-accent" type="button" onClick={onOpenProfile}>내정보에서 확인</button>}
            {claimState === 'used' && <button className="v2-btn" type="button" disabled>사용 완료</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
