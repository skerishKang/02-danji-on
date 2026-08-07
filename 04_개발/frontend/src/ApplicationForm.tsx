import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { storageAdapter, type StoredObject } from './storage';
import type { BusinessApplicationInput, RelationType } from './types';
import './application-wizard.css';

const emptyForm: BusinessApplicationInput = {
  relationType: 'resident',
  businessName: '',
  categoryName: '',
  serviceSummary: '',
  priceText: '',
  contactMethod: 'phone_sms',
  serviceArea: '방림동과 인근 지역',
  benefitText: '',
  availabilityText: '',
  representativeImageObjectKey: ''
};

const stepTitles = ['주민 관계', '기본 정보', '사진과 혜택', '공개 정보 확인'] as const;

type WizardStep = 1 | 2 | 3 | 4;

function normalizedInitial(value?: BusinessApplicationInput): BusinessApplicationInput {
  return {
    ...emptyForm,
    ...value,
    priceText: value?.priceText ?? '',
    contactMethod: value?.contactMethod ?? 'phone_sms',
    serviceArea: value?.serviceArea ?? '방림동과 인근 지역',
    benefitText: value?.benefitText ?? '',
    availabilityText: value?.availabilityText ?? '',
    representativeImageObjectKey: value?.representativeImageObjectKey ?? ''
  };
}

function relationLabel(value: RelationType) {
  return {
    resident: '내가 직접 운영',
    resident_family: '주민 가족이 운영',
    neighbor: '이웃 단지 주민 운영',
    local: '우리 동네 가게'
  }[value];
}

function contactLabel(value?: string) {
  return {
    phone_sms: '전화·문자',
    kakao: '카카오톡',
    url: '온라인 링크'
  }[value || 'phone_sms'] ?? '전화·문자';
}

export default function ApplicationForm({
  categoryNames,
  busy,
  onSubmit,
  onCancel,
  initialValue,
  mode = 'create',
  reviewNote
}: {
  categoryNames: string[];
  busy: boolean;
  onSubmit: (input: BusinessApplicationInput) => Promise<void>;
  onCancel: () => void;
  initialValue?: BusinessApplicationInput;
  mode?: 'create' | 'resubmit';
  reviewNote?: string | null;
}) {
  const [form, setForm] = useState<BusinessApplicationInput>(() => normalizedInitial(initialValue));
  const [step, setStep] = useState<WizardStep>(1);
  const [error, setError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [storedImage, setStoredImage] = useState<StoredObject | null>(null);

  useEffect(() => {
    setForm(normalizedInitial(initialValue));
    setStep(1);
    setError('');
  }, [initialValue]);

  useEffect(() => {
    return () => {
      if (storedImage) storageAdapter.releasePreview?.(storedImage);
    };
  }, [storedImage]);

  function update<K extends keyof BusinessApplicationInput>(key: K, value: BusinessApplicationInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setImageBusy(true);
    try {
      const uploaded = await storageAdapter.upload('business-image', file);
      setStoredImage(uploaded);
      update('representativeImageObjectKey', uploaded.objectKey);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '이미지를 준비하지 못했습니다.');
      event.target.value = '';
    } finally {
      setImageBusy(false);
    }
  }

  function clearImage() {
    if (storedImage) storageAdapter.releasePreview?.(storedImage);
    setStoredImage(null);
    update('representativeImageObjectKey', '');
  }

  function validateStep(current: WizardStep) {
    if (current === 2 && (!form.businessName.trim() || !form.categoryName.trim() || !form.serviceSummary.trim())) {
      setError('가게·서비스명, 분야, 한 줄 소개는 필수입니다.');
      return false;
    }
    setError('');
    return true;
  }

  function nextStep() {
    if (!validateStep(step) || step === 4) return;
    setStep((current) => Math.min(4, current + 1) as WizardStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function previousStep() {
    setError('');
    setStep((current) => Math.max(1, current - 1) as WizardStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!validateStep(2)) {
      setStep(2);
      return;
    }
    await onSubmit({
      ...form,
      businessName: form.businessName.trim(),
      categoryName: form.categoryName.trim(),
      serviceSummary: form.serviceSummary.trim(),
      representativeImageObjectKey: form.representativeImageObjectKey || undefined
    });
  }

  return (
    <form className="application-form application-wizard" onSubmit={(event) => void submit(event)}>
      <div className="form-intro">
        <span className="eyebrow">{mode === 'resubmit' ? '등록 보완' : '내 일 알리기'}</span>
        <h1>{mode === 'resubmit' ? '요청된 내용을 보완해 주세요' : '내 일을 4단계로 알려주세요'}</h1>
        <p>{mode === 'resubmit' ? '관리자 메모를 확인하고 필요한 내용을 수정한 뒤 다시 제출합니다.' : '주민 관계를 확인하고, 공개할 정보와 비공개 확인정보를 나눠 안전하게 신청합니다.'}</p>
        {mode === 'resubmit' && reviewNote && <div className="review-request-box"><strong>관리자 보완 요청</strong><p>{reviewNote}</p></div>}
      </div>

      <ol className="wizard-progress" aria-label="등록 진행 단계">
        {stepTitles.map((title, index) => {
          const number = (index + 1) as WizardStep;
          const current = number === step;
          const completed = number < step;
          return (
            <li key={title} className={current ? 'current' : completed ? 'completed' : ''} aria-current={current ? 'step' : undefined}>
              <span>{completed ? '✓' : number}</span>
              <b>{title}</b>
            </li>
          );
        })}
      </ol>

      <div className="wizard-step-heading">
        <span>STEP {step} / 4</span>
        <h2>{stepTitles[step - 1]}</h2>
      </div>

      <fieldset hidden={step !== 1}>
        <legend>우리 단지와 어떤 관계인가요?</legend>
        <p className="fieldset-help">주민 관계는 검색 노출 순서와 운영 확인에 사용되며 정확한 동·호수는 공개하지 않습니다.</p>
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

      <fieldset hidden={step !== 2}>
        <legend>가게·서비스 기본 정보</legend>
        <div className="form-grid">
          <label>
            <span>가게·서비스명 *</span>
            <input value={form.businessName} onChange={(event) => update('businessName', event.target.value)} placeholder="예: 한결수학" maxLength={80} />
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
          <label><span>가격</span><input value={form.priceText} onChange={(event) => update('priceText', event.target.value)} placeholder="예: 중등 수학 월 18만원부터" maxLength={120} /></label>
          <label><span>이용 지역</span><input value={form.serviceArea} onChange={(event) => update('serviceArea', event.target.value)} maxLength={120} /></label>
          <label><span>이용 시간</span><input value={form.availabilityText} onChange={(event) => update('availabilityText', event.target.value)} placeholder="예: 평일 오후 4시~9시" maxLength={120} /></label>
          <label><span>연락 방법</span><select value={form.contactMethod} onChange={(event) => update('contactMethod', event.target.value)}><option value="phone_sms">전화·문자</option><option value="kakao">카카오톡</option><option value="url">온라인 링크</option></select></label>
        </div>
      </fieldset>

      <fieldset hidden={step !== 3}>
        <legend>사진과 주민혜택</legend>
        <div className="form-grid wizard-benefit-grid">
          <label className="full"><span>입주민 혜택</span><input value={form.benefitText} onChange={(event) => update('benefitText', event.target.value)} placeholder="예: 첫 상담 30분 무료" maxLength={160} /></label>
        </div>
        <div className="image-upload-field">
          <div className="image-upload-copy">
            <strong>실제로 일하는 장면이나 결과물을 보여주는 사진 1장</strong>
            <p>이미지 파일만 가능하며 최대 8MB입니다. 현재는 mock storage를 사용하고, 이후 R2 연결 시 같은 폼을 그대로 사용합니다.</p>
            {form.representativeImageObjectKey && !storedImage && <p className="existing-image-key">기존 대표 이미지가 연결되어 있습니다. 새 이미지를 고르지 않으면 그대로 유지됩니다.</p>}
            <label className="image-picker">
              <input type="file" accept="image/*" onChange={(event) => void chooseImage(event)} disabled={busy || imageBusy} />
              <span>{imageBusy ? '이미지 준비 중...' : storedImage ? '다른 이미지 선택' : form.representativeImageObjectKey ? '대표 이미지 교체' : '이미지 선택'}</span>
            </label>
          </div>
          <div className={`image-preview ${storedImage?.previewUrl ? 'has-image' : ''}`}>
            {storedImage?.previewUrl ? <img src={storedImage.previewUrl} alt="등록 대표 이미지 미리보기" /> : <span>{form.representativeImageObjectKey ? '기존 대표 이미지 유지' : '대표 이미지 미리보기'}</span>}
          </div>
          {(storedImage || form.representativeImageObjectKey) && <div className="image-upload-meta"><span>{storedImage ? `${storedImage.fileName} · ${(storedImage.size / 1024 / 1024).toFixed(2)}MB` : '기존 대표 이미지 object key 유지'}</span><button type="button" onClick={clearImage}>제거</button></div>}
        </div>
      </fieldset>

      <fieldset hidden={step !== 4}>
        <legend>공개 정보와 비공개 확인정보를 확인해 주세요</legend>
        <div className="application-review-grid">
          <section className="review-surface public-review">
            <span>주민에게 공개</span>
            <h3>{form.businessName || '가게·서비스명'}</h3>
            <p>{form.serviceSummary || '한 줄 소개가 여기에 표시됩니다.'}</p>
            <dl>
              <div><dt>분야</dt><dd>{form.categoryName || '-'}</dd></div>
              <div><dt>가격</dt><dd>{form.priceText || '상담 후 안내'}</dd></div>
              <div><dt>지역</dt><dd>{form.serviceArea || '-'}</dd></div>
              <div><dt>이용 시간</dt><dd>{form.availabilityText || '-'}</dd></div>
              <div><dt>주민혜택</dt><dd>{form.benefitText || '등록된 혜택 없음'}</dd></div>
            </dl>
          </section>
          <section className="review-surface private-review">
            <span>운영 확인 · 일반 공개 안 함</span>
            <h3>주민 관계와 연락 경계</h3>
            <dl>
              <div><dt>단지와의 관계</dt><dd>{relationLabel(form.relationType)}</dd></div>
              <div><dt>연락 방식</dt><dd>{contactLabel(form.contactMethod)}</dd></div>
              <div><dt>입주민 인증</dt><dd>별도 인증 상태를 서버에서 확인</dd></div>
              <div><dt>동·호수/증빙</dt><dd>사업 정보와 분리해 비공개 보관</dd></div>
            </dl>
            <p>주민 관계 확인은 서비스 품질 보증을 의미하지 않습니다.</p>
          </section>
        </div>
      </fieldset>

      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions wizard-actions">
        {step === 1 ? <button type="button" className="secondary" onClick={onCancel} disabled={busy}>취소</button> : <button type="button" className="secondary" onClick={previousStep} disabled={busy || imageBusy}>이전</button>}
        {step < 4 ? (
          <button type="button" className="primary" onClick={nextStep} disabled={busy || imageBusy}>다음 단계</button>
        ) : (
          <button type="submit" className="primary" disabled={busy || imageBusy}>{busy ? (mode === 'resubmit' ? '재제출 중...' : '신청 중...') : (mode === 'resubmit' ? '보완 내용 재제출' : '등록 신청 완료')}</button>
        )}
      </div>
    </form>
  );
}
