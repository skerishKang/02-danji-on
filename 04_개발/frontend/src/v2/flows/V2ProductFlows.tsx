import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { storageAdapter, type StoredObject } from '../../storage';
import {
  applicationStatusLabels,
  benefitClaimStatusLabels,
  relationLabels,
  type Benefit,
  type BenefitClaim,
  type Business,
  type BusinessApplication,
  type BusinessApplicationInput,
  type BusinessContact,
  type BusinessFilters,
  type RelationType
} from '../../types';
import type { V2FlowVisualSlots } from '../V2App';

type CategoryRow = [string, string];

export function V2DiscoveryFlow({
  mode,
  businesses,
  categories,
  filters,
  bookmarks,
  highlightBusinessId,
  visualSlots,
  onSearch,
  onOpenBusiness,
  onToggleBookmark,
  onOpenBenefits,
  onOpenRegister
}: {
  mode: 'discover' | 'results';
  businesses: Business[];
  categories: CategoryRow[];
  filters: BusinessFilters;
  bookmarks: Set<string>;
  highlightBusinessId: string | null;
  visualSlots: V2FlowVisualSlots;
  onSearch: (filters: BusinessFilters) => Promise<void>;
  onOpenBusiness: (id: string) => Promise<void>;
  onToggleBookmark: (id: string) => Promise<void>;
  onOpenBenefits: () => void;
  onOpenRegister: () => void;
}) {
  const [query, setQuery] = useState(filters.query || '');
  const [category, setCategory] = useState(filters.category || 'all');
  const [relation, setRelation] = useState<RelationType | 'all'>(filters.relation || 'all');

  useEffect(() => {
    setQuery(filters.query || '');
    setCategory(filters.category || 'all');
    setRelation(filters.relation || 'all');
  }, [filters.category, filters.query, filters.relation]);

  const residentFirst = useMemo(
    () => businesses.filter((business) => business.relationType === 'resident').slice(0, 4),
    [businesses]
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSearch({ query, category, relation });
  }

  function searchWith(next: Partial<BusinessFilters>) {
    return onSearch({
      query: next.query ?? query,
      category: next.category ?? category,
      relation: next.relation ?? relation
    });
  }

  return (
    <div className="v2-discovery-flow">
      {mode === 'discover' && (
        <>
          <section className="v2-flow-hero" aria-labelledby="v2-hero-title">
            <div className="v2-flow-hero-copy">
              <span className="v2-eyebrow">DANJION · NEIGHBOR ECONOMY</span>
              <h1 id="v2-hero-title">우리 단지 안에서<br />먼저 발견하는<br />이웃의 일.</h1>
              <p>가게 이름보다 <strong>누가 어떤 일을 하는지</strong> 먼저 찾고, 주민 관계와 혜택을 확인한 뒤 안전하게 문의합니다.</p>
              <form className="v2-primary-search" onSubmit={(event) => void submit(event)}>
                <label htmlFor="v2-home-search" className="v2-sr-only">가게와 서비스 검색</label>
                <span aria-hidden="true">⌕</span>
                <input
                  id="v2-home-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="반찬, 수학 과외, 에어컨 청소, 세무 상담"
                />
                <button type="submit">검색</button>
              </form>
              <div className="v2-quick-searches" aria-label="빠른 검색">
                {['반찬', '수학 과외', '에어컨 청소', '세무 상담'].map((word) => (
                  <button type="button" key={word} onClick={() => void searchWith({ query: word, category: 'all', relation: 'all' })}>{word}</button>
                ))}
              </div>
              <div className="v2-hero-actions">
                <button type="button" className="v2-primary" onClick={() => void searchWith({ query: '', category: 'all', relation: 'resident' })}>주민이 하는 일 보기</button>
                <button type="button" onClick={onOpenRegister}>내 일 알리기</button>
              </div>
            </div>
            <div className="v2-flow-hero-media">
              {visualSlots.hero ?? (
                <div className="v2-visual-contract-placeholder">
                  <span>V2-A VISUAL SLOT</span>
                  <strong>실제 생활 장면이 들어오는 비주얼 영역</strong>
                  <p>Track B는 제품 데이터와 흐름만 소유하며, 이 영역은 V2-A의 고정 시네마틱 프리미티브를 수용합니다.</p>
                </div>
              )}
            </div>
          </section>

          <section className="v2-cinematic-contract" aria-label="생활 장면 탐색">
            {visualSlots.cinematic ?? (
              <div className="v2-cinematic-placeholder">
                <div><span>01</span><b>먹고 마시는 일</b><p>반찬·카페·생활 식품</p></div>
                <div><span>02</span><b>배우고 가르치는 일</b><p>과외·레슨·교육</p></div>
                <div><span>03</span><b>집을 돌보는 일</b><p>청소·수리·생활관리</p></div>
                <div><span>04</span><b>사업을 돕는 일</b><p>세무·상담·전문서비스</p></div>
              </div>
            )}
          </section>

          <section className="v2-flow-section">
            <header className="v2-section-heading">
              <div><span className="v2-eyebrow">DISCOVER</span><h2>같은 단지 주민의 일을 먼저</h2></div>
              <p>기존 `dataAdapter.listBusinesses`가 가진 주민 관계 우선순위를 그대로 사용합니다.</p>
            </header>
            <div className="v2-business-grid">
              {residentFirst.map((business) => (
                <BusinessCard
                  key={business.id}
                  business={business}
                  bookmarked={bookmarks.has(business.id)}
                  highlighted={highlightBusinessId === business.id}
                  media={visualSlots.businessMedia?.(business, 'card')}
                  onOpen={() => void onOpenBusiness(business.id)}
                  onToggleBookmark={() => void onToggleBookmark(business.id)}
                />
              ))}
              {!residentFirst.length && <div className="v2-empty">현재 노출 가능한 주민 가게·서비스가 없습니다.</div>}
            </div>
          </section>

          <section className="v2-flow-cycle">
            <div><span>주민혜택</span><h2>발견에서 끝나지 않게</h2><p>혜택을 내 지갑에 보관하고 실제 사용 상태까지 기존 benefit contract로 이어갑니다.</p><button type="button" onClick={onOpenBenefits}>주민혜택 보기</button></div>
            <div><span>내 일 알리기</span><h2>소비자가 다시 공급자가 되는 흐름</h2><p>등록 신청 → 홍보물 미리보기 → 운영 확인/승인 → 다시 검색 노출의 순환을 연결합니다.</p><button type="button" onClick={onOpenRegister}>등록 시작</button></div>
          </section>
        </>
      )}

      {mode === 'results' && (
        <section className="v2-flow-section v2-results-section">
          <header className="v2-section-heading">
            <div><span className="v2-eyebrow">SEARCH / FILTER</span><h1>이웃가게와 서비스</h1></div>
            <p>검색·분야·주민 관계 필터는 기존 DataAdapter의 `BusinessFilters`에 그대로 매핑됩니다.</p>
          </header>
          <form className="v2-filter-bar" onSubmit={(event) => void submit(event)}>
            <label><span>검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="하는 일이나 가게 이름" /></label>
            <label><span>관계</span><select value={relation} onChange={(event) => setRelation(event.target.value as RelationType | 'all')}><option value="all">전체 관계</option><option value="resident">현재 단지 주민</option><option value="resident_family">주민 가족</option><option value="neighbor">이웃 단지 주민</option><option value="local">우리 동네 가게</option></select></label>
            <button type="submit" className="v2-primary">검색 적용</button>
          </form>
          <div className="v2-category-rail" aria-label="분야 필터">
            <button type="button" className={category === 'all' ? 'active' : ''} onClick={() => { setCategory('all'); void searchWith({ category: 'all' }); }}>전체</button>
            {categories.map(([slug, name]) => (
              <button type="button" key={slug} className={category === slug ? 'active' : ''} onClick={() => { setCategory(slug); void searchWith({ category: slug }); }}>{name}</button>
            ))}
          </div>
          <div className="v2-result-summary"><strong>{businesses.length}</strong><span>개의 결과 · 주민 관계 우선순위 유지</span></div>
          <div className="v2-business-grid">
            {businesses.map((business) => (
              <BusinessCard
                key={business.id}
                business={business}
                bookmarked={bookmarks.has(business.id)}
                highlighted={highlightBusinessId === business.id}
                media={visualSlots.businessMedia?.(business, 'card')}
                onOpen={() => void onOpenBusiness(business.id)}
                onToggleBookmark={() => void onToggleBookmark(business.id)}
              />
            ))}
            {!businesses.length && <div className="v2-empty">조건에 맞는 이웃의 일이 없습니다. 필터를 바꾸거나 다른 검색어를 입력해 주세요.</div>}
          </div>
        </section>
      )}
    </div>
  );
}

function BusinessCard({
  business,
  bookmarked,
  highlighted,
  media,
  onOpen,
  onToggleBookmark
}: {
  business: Business;
  bookmarked: boolean;
  highlighted: boolean;
  media?: React.ReactNode;
  onOpen: () => void;
  onToggleBookmark: () => void;
}) {
  return (
    <article className={`v2-business-card ${highlighted ? 'v2-newly-approved' : ''}`} data-business-id={business.id}>
      <button type="button" className="v2-business-media" onClick={onOpen} aria-label={`${business.name} 상세 보기`}>
        {media ?? <span className="v2-business-media-fallback" aria-hidden="true">{business.icon || business.name.slice(0, 1)}</span>}
        {highlighted && <b>방금 운영확인 완료</b>}
      </button>
      <div className="v2-business-copy">
        <div className="v2-business-topline"><span>{relationLabels[business.relationType]}</span><button type="button" onClick={onToggleBookmark} aria-label={bookmarked ? '저장 해제' : '저장'}>{bookmarked ? '♥' : '♡'}</button></div>
        <button type="button" className="v2-business-title" onClick={onOpen}><strong>{business.name}</strong><span>{business.summary}</span></button>
        <div className="v2-business-meta"><b>{business.priceText}</b><span>{business.categoryName}</span></div>
        {business.activeBenefit && <div className="v2-card-benefit"><span>주민혜택</span><strong>{business.activeBenefit.title}</strong></div>}
      </div>
    </article>
  );
}

function contactLabel(type: BusinessContact['type']) {
  return { phone: '전화', sms: '문자', kakao: '카카오톡', url: '온라인' }[type];
}

export function V2DetailFlow({
  business,
  contacts,
  bookmarked,
  visualSlots,
  busy,
  onBack,
  onToggleBookmark,
  onRevealContacts,
  onClaimBenefit
}: {
  business: Business;
  contacts: BusinessContact[];
  bookmarked: boolean;
  visualSlots: V2FlowVisualSlots;
  busy: boolean;
  onBack: () => void;
  onToggleBookmark: () => void;
  onRevealContacts: () => void;
  onClaimBenefit: (benefitId: string) => void;
}) {
  return (
    <section className="v2-flow-section v2-detail-flow">
      <button type="button" className="v2-back" onClick={onBack}>← 검색 결과</button>
      <div className="v2-detail-grid">
        <div className="v2-detail-media">
          {visualSlots.businessMedia?.(business, 'detail') ?? <span className="v2-detail-media-fallback" aria-hidden="true">{business.icon}</span>}
          <small>대표 이미지는 기존 Business/Storage 계약이 제공하는 범위에서만 연결합니다.</small>
        </div>
        <div className="v2-detail-copy">
          <span className="v2-relation-label">{relationLabels[business.relationType]}</span>
          <h1>{business.name}</h1>
          <p className="v2-detail-lead">{business.summary}</p>
          <strong className="v2-detail-price">{business.priceText}</strong>
          <dl className="v2-detail-facts">
            <div><dt>분야</dt><dd>{business.categoryName}</dd></div>
            <div><dt>이용 지역</dt><dd>{business.serviceArea}</dd></div>
            <div><dt>이용 시간</dt><dd>{business.availabilityText}</dd></div>
            <div><dt>문의 정보</dt><dd>기존 서버의 입주민 인증·권한 검사를 통과한 경우에만 표시</dd></div>
          </dl>
          <div className="v2-detail-actions">
            <button type="button" onClick={onToggleBookmark}>{bookmarked ? '♥ 저장됨' : '♡ 저장하기'}</button>
            <button type="button" className="v2-primary" disabled={busy} onClick={onRevealContacts}>문의 방법 확인</button>
          </div>
          {contacts.length > 0 && (
            <div className="v2-private-contact" aria-live="polite">
              <span>인증 주민 전용</span>
              <strong>문의 방법</strong>
              {contacts.map((contact, index) => <p key={`${contact.type}-${index}`}>{contactLabel(contact.type)} · {contact.value}</p>)}
            </div>
          )}
        </div>
      </div>
      <div className="v2-detail-story"><span className="v2-eyebrow">NEIGHBOR STORY</span><h2>이웃이 하는 일을 이해하고 선택합니다.</h2><p>{business.description}</p></div>
      {business.activeBenefit && (
        <div className="v2-detail-benefit">
          <div><span className="v2-eyebrow">RESIDENT BENEFIT</span><h2>{business.activeBenefit.title}</h2><p>{business.activeBenefit.description}</p>{business.activeBenefit.conditions && <small>{business.activeBenefit.conditions}</small>}</div>
          <button type="button" className="v2-primary" disabled={busy} onClick={() => onClaimBenefit(business.activeBenefit!.id)}>주민혜택 받기</button>
        </div>
      )}
    </section>
  );
}

export function V2BenefitFlow({ benefits, claims, busy, onClaim, onUse, onOpenBusiness, onOpenRegister }: {
  benefits: Benefit[];
  claims: BenefitClaim[];
  busy: boolean;
  onClaim: (benefitId: string) => void;
  onUse: (benefitId: string) => void;
  onOpenBusiness: (businessId: string) => void;
  onOpenRegister: () => void;
}) {
  const claimByBenefit = new Map(claims.map((claim) => [claim.benefitId, claim]));
  return (
    <section className="v2-flow-section v2-benefit-flow">
      <header className="v2-section-heading">
        <div><span className="v2-eyebrow">RESIDENT BENEFIT</span><h1>받고, 보관하고, 사용까지</h1></div>
        <p>V2도 기존 `claimBenefit` / `useBenefit` 계약을 그대로 사용합니다. 혜택 상태를 별도 브라우저 규칙으로 재정의하지 않습니다.</p>
      </header>
      <div className="v2-benefit-grid">
        {benefits.map((benefit) => {
          const claim = claimByBenefit.get(benefit.id);
          return (
            <article key={benefit.id} className="v2-benefit-card">
              <span>입주민 전용</span>
              <h2>{benefit.title}</h2>
              <button type="button" className="v2-text-link" onClick={() => onOpenBusiness(benefit.businessId)}>{benefit.businessName} 상세 보기 →</button>
              <p>{benefit.description}</p>
              {benefit.conditions && <small>{benefit.conditions}</small>}
              <div className="v2-benefit-action">
                {!claim && <button type="button" className="v2-primary" disabled={busy} onClick={() => onClaim(benefit.id)}>혜택 받기</button>}
                {claim?.status === 'stored' && <button type="button" className="v2-primary" disabled={busy} onClick={() => onUse(benefit.id)}>사용 완료 처리</button>}
                {claim?.status === 'used' && <button type="button" disabled>사용 완료</button>}
                {claim && <code>{claim.code} · {benefitClaimStatusLabels[claim.status]}</code>}
              </div>
            </article>
          );
        })}
        {!benefits.length && <div className="v2-empty">현재 공개 중인 주민혜택이 없습니다.</div>}
      </div>
      <section className="v2-wallet-strip">
        <div><span>내 혜택 지갑</span><strong>{claims.length}</strong><p>기존 BenefitClaim 상태를 그대로 표시합니다.</p></div>
        <div className="v2-wallet-items">{claims.slice(0, 5).map((claim) => <div key={claim.id}><b>{claim.businessName}</b><span>{claim.title}</span><code>{claim.code}</code></div>)}{!claims.length && <p>아직 받은 혜택이 없습니다.</p>}</div>
      </section>
      <div className="v2-flow-next"><div><span>다음 순환</span><h2>나도 이웃에게 내 일을 알릴 수 있습니다.</h2></div><button type="button" onClick={onOpenRegister}>내 일 알리기</button></div>
    </section>
  );
}

const emptyApplication: BusinessApplicationInput = {
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

const stepTitles = ['주민 관계', '하는 일', '사진과 혜택', '공개 경계 확인'] as const;
type Step = 1 | 2 | 3 | 4;

function initialForm(value?: BusinessApplicationInput): BusinessApplicationInput {
  return { ...emptyApplication, ...value };
}

function relationLabel(value: RelationType) {
  return { resident: '내가 직접 운영', resident_family: '주민 가족이 운영', neighbor: '이웃 단지 주민 운영', local: '우리 동네 가게' }[value];
}

export function V2RegistrationFlow({ categoryNames, busy, initialValue, mode, reviewNote, onSubmit, onCancel }: {
  categoryNames: string[];
  busy: boolean;
  initialValue?: BusinessApplicationInput;
  mode: 'create' | 'resubmit';
  reviewNote?: string | null;
  onSubmit: (input: BusinessApplicationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<BusinessApplicationInput>(() => initialForm(initialValue));
  const [storedImage, setStoredImage] = useState<StoredObject | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(initialForm(initialValue));
    setStep(1);
    setError('');
  }, [initialValue]);

  useEffect(() => () => {
    if (storedImage) storageAdapter.releasePreview?.(storedImage);
  }, [storedImage]);

  function update<K extends keyof BusinessApplicationInput>(key: K, value: BusinessApplicationInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validateRequired() {
    if (!form.businessName.trim() || !form.categoryName.trim() || !form.serviceSummary.trim()) {
      setError('가게·서비스명, 분야, 하는 일 설명은 필수입니다.');
      return false;
    }
    setError('');
    return true;
  }

  function next() {
    if (step === 2 && !validateRequired()) return;
    if (step < 4) setStep((step + 1) as Step);
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageBusy(true);
    setError('');
    try {
      const uploaded = await storageAdapter.upload('business-image', file);
      if (storedImage) storageAdapter.releasePreview?.(storedImage);
      setStoredImage(uploaded);
      update('representativeImageObjectKey', uploaded.objectKey);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '대표 이미지를 준비하지 못했습니다.');
      event.target.value = '';
    } finally {
      setImageBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validateRequired()) {
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
    <section className="v2-flow-section v2-registration-flow">
      <header className="v2-section-heading">
        <div><span className="v2-eyebrow">{mode === 'resubmit' ? 'RESUBMIT' : 'TELL YOUR WORK'}</span><h1>{mode === 'resubmit' ? '보완하고 다시 제출하기' : '내 일을 이웃에게 알리기'}</h1></div>
        <p>V2 전용 신청 스키마를 만들지 않고 기존 `BusinessApplicationInput`과 StorageAdapter를 그대로 사용합니다.</p>
      </header>
      {mode === 'resubmit' && reviewNote && <div className="v2-review-note"><span>운영자 보완 요청</span><strong>{reviewNote}</strong></div>}
      <ol className="v2-register-steps" aria-label="등록 단계">
        {stepTitles.map((title, index) => {
          const number = (index + 1) as Step;
          return <li key={title} className={number === step ? 'active' : number < step ? 'done' : ''}><span>{number < step ? '✓' : number}</span><b>{title}</b></li>;
        })}
      </ol>
      <form className="v2-register-form" onSubmit={(event) => void submit(event)}>
        {step === 1 && (
          <fieldset><legend>우리 단지와 어떤 관계인가요?</legend><p>관계 정보는 검색 우선순위와 운영 확인에 사용됩니다. 정확한 동·호수나 인증문서는 이 공개 프로필에 넣지 않습니다.</p><div className="v2-relation-options">{([
            ['resident', '내가 직접 운영'], ['resident_family', '주민 가족이 운영'], ['neighbor', '이웃 단지 주민 운영'], ['local', '우리 동네 가게']
          ] as Array<[RelationType, string]>).map(([value, label]) => <label key={value} className={form.relationType === value ? 'selected' : ''}><input type="radio" name="v2-relation" checked={form.relationType === value} onChange={() => update('relationType', value)} /><strong>{label}</strong></label>)}</div></fieldset>
        )}
        {step === 2 && (
          <fieldset><legend>무슨 일을 하시나요?</legend><div className="v2-form-grid"><label><span>가게·서비스명 *</span><input value={form.businessName} onChange={(event) => update('businessName', event.target.value)} maxLength={80} placeholder="예: 한결수학" /></label><label><span>분야 *</span><input list="v2-business-categories" value={form.categoryName} onChange={(event) => update('categoryName', event.target.value)} maxLength={80} /><datalist id="v2-business-categories">{categoryNames.map((name) => <option key={name} value={name} />)}</datalist></label><label className="wide"><span>하는 일 *</span><textarea value={form.serviceSummary} onChange={(event) => update('serviceSummary', event.target.value)} maxLength={240} rows={4} placeholder="이웃이 바로 이해할 수 있도록 하는 일을 적어주세요." /></label><label><span>가격/기준</span><input value={form.priceText || ''} onChange={(event) => update('priceText', event.target.value)} maxLength={120} /></label><label><span>이용 지역</span><input value={form.serviceArea || ''} onChange={(event) => update('serviceArea', event.target.value)} maxLength={120} /></label><label><span>이용 시간</span><input value={form.availabilityText || ''} onChange={(event) => update('availabilityText', event.target.value)} maxLength={120} /></label><label><span>문의 방식</span><select value={form.contactMethod || 'phone_sms'} onChange={(event) => update('contactMethod', event.target.value)}><option value="phone_sms">전화·문자</option><option value="kakao">카카오톡</option><option value="url">온라인 링크</option></select></label></div></fieldset>
        )}
        {step === 3 && (
          <fieldset><legend>일하는 장면과 주민혜택</legend><div className="v2-upload-grid"><div><label className="v2-file-picker"><span>{imageBusy ? '이미지 처리 중…' : '대표 이미지 선택'}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || imageBusy} onChange={(event) => void chooseImage(event)} /></label><p>기존 StorageAdapter의 `business-image` 정책을 사용합니다. mock/Drive 모드는 현재 환경설정을 그대로 따릅니다.</p></div><div className="v2-upload-preview">{storedImage?.previewUrl ? <img src={storedImage.previewUrl} alt="등록 대표 이미지 미리보기" /> : <span>{form.representativeImageObjectKey ? '기존 대표 이미지 연결 유지' : '대표 이미지 미리보기'}</span>}</div></div><label className="v2-benefit-input"><span>입주민 혜택</span><input value={form.benefitText || ''} onChange={(event) => update('benefitText', event.target.value)} maxLength={160} placeholder="예: 첫 수업 무료" /></label></fieldset>
        )}
        {step === 4 && (
          <fieldset><legend>공개 정보와 운영 확인 정보를 나눠 확인합니다.</legend><div className="v2-public-private-review"><article><span>주민에게 공개</span><h2>{form.businessName || '가게·서비스명'}</h2><p>{form.serviceSummary || '하는 일 설명'}</p><dl><div><dt>분야</dt><dd>{form.categoryName || '-'}</dd></div><div><dt>가격</dt><dd>{form.priceText || '상담 후 안내'}</dd></div><div><dt>지역</dt><dd>{form.serviceArea || '-'}</dd></div><div><dt>주민혜택</dt><dd>{form.benefitText || '없음'}</dd></div></dl></article><article className="private"><span>운영 확인 · 공개하지 않음</span><h2>주민 관계와 인증 경계</h2><dl><div><dt>관계</dt><dd>{relationLabel(form.relationType)}</dd></div><div><dt>입주민 인증</dt><dd>기존 서버 resident-verification 상태를 사용</dd></div><div><dt>동·호수/증빙</dt><dd>사업 공개 정보와 분리된 비공개 영역</dd></div></dl><p>Track B는 인증문서 원문이나 새 인증 상태를 만들지 않습니다.</p></article></div></fieldset>
        )}
        {error && <div className="v2-form-error" role="alert">{error}</div>}
        <div className="v2-register-actions">
          {step === 1 ? <button type="button" onClick={onCancel}>취소</button> : <button type="button" onClick={() => setStep((step - 1) as Step)}>이전</button>}
          {step < 4 ? <button type="button" className="v2-primary" disabled={busy || imageBusy} onClick={next}>다음</button> : <button type="submit" className="v2-primary" disabled={busy || imageBusy}>{busy ? '제출 중…' : mode === 'resubmit' ? '보완 내용 다시 제출' : '등록 검토 요청'}</button>}
        </div>
      </form>
    </section>
  );
}

export function V2PromotionFlow({ application, generated, visualSlots, onGenerate, onOpenOperator, onEditApplication, onBackDiscovery }: {
  application: BusinessApplication;
  generated: boolean;
  visualSlots: V2FlowVisualSlots;
  onGenerate: () => void;
  onOpenOperator: () => void;
  onEditApplication?: () => void;
  onBackDiscovery: () => void;
}) {
  const benefit = application.benefitText || '등록된 주민혜택 없음';
  return (
    <section className="v2-flow-section v2-promotion-flow">
      <header className="v2-section-heading">
        <div><span className="v2-eyebrow">PROMOTION PREVIEW</span><h1>등록한 정보로 홍보물을 미리 봅니다.</h1></div>
        <p>이 단계는 서버에 새 홍보물 스키마를 저장하지 않습니다. 기존 신청 데이터를 안전하게 재배치하는 <strong>브라우저 미리보기</strong>입니다.</p>
      </header>
      <div className="v2-promo-status"><div><span>현재 신청</span><strong>{application.businessName}</strong><b>{applicationStatusLabels[application.status]}</b></div><button type="button" className="v2-primary" onClick={onGenerate}>{generated ? '홍보물 다시 구성' : '홍보물 만들기'}</button></div>
      <div className={`v2-promo-grid ${generated ? 'generated' : ''}`} aria-live="polite">
        <article className="v2-promo-card listing"><div className="v2-promo-media">{visualSlots.promotionMedia?.(application) ?? <span>{application.representativeImageObjectKey ? '대표 이미지 연결됨' : application.businessName.slice(0, 1)}</span>}</div><small>단지온 가게소개 카드</small><h2>{application.businessName}</h2><p>{application.serviceSummary}</p><strong>{benefit}</strong></article>
        <article className="v2-promo-card share"><small>메신저 공유 이미지</small><h2>우리 단지에<br />{application.serviceSummary}<br />하는 이웃이 있습니다.</h2><div><b>{application.businessName}</b><span>{application.priceText || '상담 후 안내'}</span><strong>{benefit}</strong></div></article>
        <article className="v2-promo-card poster"><small>게시판 포스터</small><h2>{application.businessName}</h2><strong>{benefit}</strong><p>{relationLabels[application.relationType]}<br />{application.serviceArea || '방림동과 인근 지역'}</p></article>
      </div>
      {!generated && <div className="v2-promo-gate">홍보물 만들기를 누르면 세 가지 미리보기가 활성화됩니다. 생성 결과를 새 DB나 Drive 폴더에 저장하지 않습니다.</div>}
      <div className="v2-promo-actions">{onEditApplication ? <button type="button" onClick={onEditApplication}>보완하기</button> : <button type="button" onClick={onBackDiscovery}>발견으로 돌아가기</button>}<button type="button" className="v2-primary" disabled={!generated || !['pending', 'changes_requested'].includes(application.status)} onClick={onOpenOperator}>운영확인으로 이동</button></div>
    </section>
  );
}

export function V2OperatorReviewFlow({ application, busy, adminAuthMode, onReview, onBack }: {
  application: BusinessApplication;
  busy: boolean;
  adminAuthMode: string;
  onReview: (status: 'changes_requested' | 'approved' | 'rejected', note: string) => Promise<void>;
  onBack: () => void;
}) {
  const [note, setNote] = useState(application.reviewNote || '');
  useEffect(() => setNote(application.reviewNote || ''), [application.id, application.reviewNote]);
  const reviewable = application.status === 'pending' || application.status === 'changes_requested';
  return (
    <section className="v2-flow-section v2-operator-flow">
      <header className="v2-section-heading">
        <div><span className="v2-eyebrow">OPERATOR REVIEW</span><h1>공개할 정보와 비공개 관계를 나눠 확인</h1></div>
        <p>실제 API 모드에서는 기존 `adminAdapter`와 서버의 manager/admin + verified membership 검사를 그대로 통과해야 합니다.</p>
      </header>
      <div className="v2-operator-banner"><span>현재 admin auth interface</span><strong>{adminAuthMode}</strong><b>{applicationStatusLabels[application.status]}</b></div>
      <div className="v2-operator-grid">
        <article><span>공개정보 확인</span><h2>{application.businessName}</h2><dl><div><dt>하는 일</dt><dd>{application.serviceSummary}</dd></div><div><dt>분야</dt><dd>{application.categoryName}</dd></div><div><dt>가격/기준</dt><dd>{application.priceText || '상담 후 안내'}</dd></div><div><dt>주민혜택</dt><dd>{application.benefitText || '없음'}</dd></div><div><dt>관계 표시</dt><dd>{relationLabels[application.relationType]}</dd></div></dl></article>
        <article className="private"><span>비공개 주민관계 확인</span><h2>원문을 V2에 복제하지 않습니다.</h2><dl><div><dt>관계 상태</dt><dd>기존 membership / resident-verification 계약에서 판정</dd></div><div><dt>확인자료</dt><dd>private storage 경계 유지 · 이 화면에 원문 미노출</dd></div><div><dt>공개 금지</dt><dd>동·호수, 인증문서 원문, 내부 검수정보</dd></div></dl><p>이 UI는 최종 로그인 provider를 선택하거나 인증 정책을 우회하지 않습니다.</p></article>
      </div>
      <label className="v2-operator-note"><span>검토 메모</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} disabled={!reviewable || busy} placeholder="보완 사유 또는 검토 메모" /></label>
      <div className="v2-operator-actions"><button type="button" onClick={onBack}>홍보물로 돌아가기</button><button type="button" disabled={!reviewable || busy} onClick={() => void onReview('changes_requested', note)}>보완 요청</button><button type="button" className="v2-danger" disabled={!reviewable || busy} onClick={() => void onReview('rejected', note)}>반려</button><button type="button" className="v2-primary" disabled={!reviewable || busy} onClick={() => void onReview('approved', note)}>{busy ? '처리 중…' : '승인하여 공개'}</button></div>
      {application.status === 'approved' && <div className="v2-operator-complete">이미 승인된 신청입니다. 기존 승인 materialization 결과를 검색에서 다시 확인할 수 있습니다.</div>}
    </section>
  );
}
