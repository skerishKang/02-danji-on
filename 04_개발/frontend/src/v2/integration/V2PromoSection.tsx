import type { BusinessApplication } from '../../types';
import { V2_DEMO_OPERATOR_MODE } from './v2-live-data';

export default function V2PromoSection({
  application,
  generated,
  onGenerate,
  onOpenOperator
}: {
  application: BusinessApplication | null;
  generated: boolean;
  onGenerate: () => void;
  onOpenOperator: () => void;
}) {
  return (
    <section id="v2-promo" data-v2-section="promo" className="v2-integration-section v2-promo-section">
      <div className="v2-section-inner">
        <div className="v2-section-heading">
          <div><div className="v2-kicker">SCENE 06 · PROMOTION</div><h2 className="v2-section-title">입력한 생활정보가 홍보물로 정돈됩니다.</h2></div>
          <p>홍보물은 직접 운영 등록 신청 데이터를 재배치한 브라우저 미리보기입니다. 이웃가게 추천에는 소유자 홍보물을 만들지 않습니다.</p>
        </div>
        <div className="v2-promo-control">
          <div><span>현재 신청</span><strong>{application?.businessName ?? '아직 직접 운영 등록 신청이 없습니다.'}</strong></div>
          <button type="button" className="v2-btn v2-btn-primary" disabled={!application} onClick={onGenerate}>홍보물 만들기</button>
        </div>
        {generated && application && (
          <div className="v2-integrated-promo-grid" aria-live="polite">
            <article><small>단지온 가게소개 카드</small><h3>{application.businessName}</h3><p>{application.serviceSummary}</p><strong>{application.benefitText || '등록된 주민혜택 없음'}</strong></article>
            <article><small>카카오톡 공유 이미지</small><h3>우리 단지에<br />{application.serviceSummary}<br />하는 이웃이 있습니다.</h3><p>{application.businessName}</p></article>
            <article><small>엘리베이터 게시판 포스터</small><h3>{application.businessName}</h3><strong>{application.benefitText || '주민혜택 안내'}</strong><p>{application.serviceArea || '방림명지로드힐 생활권'}</p></article>
          </div>
        )}
        <div className="v2-promo-next">
          {V2_DEMO_OPERATOR_MODE ? (
            <button type="button" className="v2-btn" disabled={!generated || !application} onClick={onOpenOperator}>운영확인으로 이동</button>
          ) : (
            application && <div className="v2-operator-pending" role="status"><strong>운영자 검토 대기</strong><span>실서비스에서는 신청자가 승인하지 않습니다. 운영자 화면에서 검토·승인된 뒤 공개 목록에 반영됩니다.</span></div>
          )}
        </div>
      </div>
    </section>
  );
}
