import type { Ref } from 'react';
import type { BusinessApplication } from '../../types';

export default function V2OperatorReviewDialog({
  application,
  busy,
  closeRef,
  onClose,
  onApprove
}: {
  application: BusinessApplication;
  busy: boolean;
  closeRef?: Ref<HTMLButtonElement>;
  onClose: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="v2-dialog-backdrop">
      <section className="v2-dialog v2-operator-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-operator-title">
        <button ref={closeRef} type="button" className="v2-dialog-close" onClick={onClose}>닫기</button>
        <span className="v2-eyebrow">OPERATOR REVIEW · DEMO ONLY</span><h2 id="v2-operator-title">운영확인</h2>
        <div className="v2-public-private"><article><span>공개정보 확인</span><h3>{application.businessName}</h3><p>{application.serviceSummary}</p><strong>{application.benefitText || '주민혜택 없음'}</strong></article><article><span>비공개 주민관계 확인</span><h3>주민 관계와 인증 경계</h3><p>정확한 동·호수와 증빙 원문은 공개하지 않습니다.</p></article></div>
        <div className="v2-dialog-actions"><button type="button" className="v2-btn" onClick={onClose}>홍보물로 돌아가기</button><button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={onApprove}>승인하여 공개</button></div>
      </section>
    </div>
  );
}
