import { useState, type FormEvent } from 'react';
import type { BusinessApplicationInput, RelationType } from './types';

const initialForm: BusinessApplicationInput = {
  relationType: 'resident',
  businessName: '',
  categoryName: '',
  serviceSummary: '',
  priceText: '',
  contactMethod: 'phone_sms',
  serviceArea: '방림동과 인근 지역',
  benefitText: '',
  availabilityText: ''
};

export default function ApplicationForm({
  categoryNames,
  busy,
  onSubmit,
  onCancel
}: {
  categoryNames: string[];
  busy: boolean;
  onSubmit: (input: BusinessApplicationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BusinessApplicationInput>(initialForm);
  const [error, setError] = useState('');

  function update<K extends keyof BusinessApplicationInput>(key: K, value: BusinessApplicationInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!form.businessName.trim() || !form.categoryName.trim() || !form.serviceSummary.trim()) {
      setError('가게·서비스명, 분야, 소개는 필수입니다.');
      return;
    }
    await onSubmit({
      ...form,
      businessName: form.businessName.trim(),
      categoryName: form.categoryName.trim(),
      serviceSummary: form.serviceSummary.trim()
    });
  }

  return (
    <form className="application-form" onSubmit={(event) => void submit(event)}>
      <div className="form-intro">
        <span className="eyebrow">내 일 알리기</span>
        <h1>가게와 서비스를 등록해 주세요</h1>
        <p>점포가 없는 과외·상담·수리·온라인 판매도 신청할 수 있습니다. 승인 전에는 공개되지 않습니다.</p>
      </div>

      <fieldset>
        <legend>1. 우리 단지와의 관계</legend>
        <div className="relation-options">
          {([
            ['resident', '내가 직접 운영'],
            ['resident_family', '주민 가족이 운영'],
            ['neighbor', '이웃 단지 주민 운영'],
            ['local', '우리 동네 가게']
          ] as Array<[RelationType, string]>).map(([value, label]) => (
            <label key={value} className={form.relationType === value ? 'selected' : ''}>
              <input type="radio" name="relationType" value={value} checked={form.relationType === value} onChange={() => update('relationType', value)} />
              <strong>{label}</strong>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>2. 기본 정보</legend>
        <div className="form-grid">
          <label>
            <span>가게·서비스명 *</span>
            <input value={form.businessName} onChange={(event) => update('businessName', event.target.value)} placeholder="예: 정성 홈베이킹" maxLength={80} />
          </label>
          <label>
            <span>분야 *</span>
            <input list="business-categories" value={form.categoryName} onChange={(event) => update('categoryName', event.target.value)} placeholder="분야를 선택하거나 입력" maxLength={80} />
            <datalist id="business-categories">{categoryNames.map((name) => <option key={name} value={name} />)}</datalist>
          </label>
          <label className="full">
            <span>한 줄 소개 *</span>
            <textarea value={form.serviceSummary} onChange={(event) => update('serviceSummary', event.target.value)} placeholder="무엇을 제공하는지 짧고 명확하게 적어주세요." maxLength={240} rows={3} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>3. 이용 정보</legend>
        <div className="form-grid">
          <label><span>가격</span><input value={form.priceText} onChange={(event) => update('priceText', event.target.value)} placeholder="예: 벽걸이 65,000원부터" maxLength={120} /></label>
          <label><span>연락 방법</span><select value={form.contactMethod} onChange={(event) => update('contactMethod', event.target.value)}><option value="phone_sms">전화·문자</option><option value="kakao">카카오톡</option><option value="url">온라인 링크</option></select></label>
          <label><span>이용 지역</span><input value={form.serviceArea} onChange={(event) => update('serviceArea', event.target.value)} maxLength={120} /></label>
          <label><span>이용 시간</span><input value={form.availabilityText} onChange={(event) => update('availabilityText', event.target.value)} placeholder="예: 평일 오전 10시~오후 6시" maxLength={120} /></label>
          <label className="full"><span>입주민 혜택</span><input value={form.benefitText} onChange={(event) => update('benefitText', event.target.value)} placeholder="예: 첫 주문 10% 할인" maxLength={160} /></label>
        </div>
      </fieldset>

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? '신청 중...' : '등록 신청하기'}</button>
      </div>
    </form>
  );
}
