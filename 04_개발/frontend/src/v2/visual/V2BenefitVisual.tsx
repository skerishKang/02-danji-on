import { V2VisualImage } from './V2VisualImage';
import { V2_REFERENCE_IMAGES } from './visual-data';

export type V2BenefitState = 'available' | 'stored' | 'used';

export function V2BenefitVisual({
  shopName = '오늘의 반찬',
  benefitText = '주민 10% 할인',
  code,
  state = 'available',
  onAction
}: {
  shopName?: string;
  benefitText?: string;
  code?: string;
  state?: V2BenefitState;
  onAction?: () => void;
}) {
  const image = V2_REFERENCE_IMAGES.food;
  const copy = state === 'available' ? '아직 받지 않은 혜택' : state === 'stored' ? '내 혜택함에 보관됨' : '사용 완료';
  const action = state === 'available' ? '주민혜택 받기' : state === 'stored' ? '혜택 사용하기' : '사용 완료';
  return (
    <section className="v2-benefits" aria-labelledby="v2-benefit-title">
      <div className="v2-section-inner v2-benefit-layout">
        <div className="v2-benefit-photo">
          <V2VisualImage src={image.src} alt="주민 혜택을 제공하는 가게의 작업 장면" fallbackLabel={shopName} />
          <div className="v2-benefit-photo-copy"><div className="v2-eyebrow">SCENE 04 · 주민혜택</div><h2 id="v2-benefit-title">혜택이<br />실제 행동이 됩니다.</h2><p>가게의 작업 장면에서 혜택 카드가 앞으로 분리되는 듯한 깊이를 주되, 혜택번호와 사용 상태는 명확한 제품 UI로 표시합니다.</p></div>
        </div>
        <div className="v2-benefit-panel">
          <div className="v2-benefit-card">
            <span className="v2-tag">방림명지로드힐 입주민 전용 · 시연용 예시</span>
            <h3>{shopName}</h3>
            <div className="v2-benefit-big">{benefitText}</div>
            <div className="v2-benefit-code"><span>혜택번호</span><strong>{code ?? '받기 전'}</strong></div>
            <div className="v2-benefit-status"><span className={`v2-status-dot v2-status-${state}`} /><span>{copy}</span></div>
            <button className="v2-btn v2-btn-accent" type="button" onClick={onAction} disabled={state === 'used'}>{action}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
