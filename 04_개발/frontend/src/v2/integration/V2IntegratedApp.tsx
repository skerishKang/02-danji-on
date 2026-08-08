import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { adminAdapter } from '../../admin-api';
import { dataAdapter } from '../../api/adapter';
import type {
  Benefit,
  BenefitClaim,
  Business,
  BusinessApplication,
  BusinessApplicationInput,
  BusinessContact,
  RelationType
} from '../../types';
import {
  V2CinematicScenes,
  V2FilterBar,
  V2Hero,
  V2Icon,
  V2Topbar,
  V2VisualImage,
  V2_CATEGORY_LABELS,
  V2_REFERENCE_IMAGES,
  V2_RELATION_LABELS,
  V2_SAMPLE_SHOPS,
  type V2CategoryKey,
  type V2RelationKey,
  type V2ShopVisual,
  type V2VisualNavKey
} from '../visual';
import '../v2-visual.css';
import './v2-integration.css';

const LOCAL_IMAGE_FALLBACK = '/field-demo/scenes-sprite.jpg';

const adapterIdByVisualId: Record<string, string> = {
  'food-01': 'v5-1',
  'learning-preview': 'v5-4',
  'home-01': 'v5-3',
  'pro-01': 'v5-6',
  'craft-01': 'v5-9',
  'car-01': 'v5-2',
  'beauty-01': 'v5-5',
  'photo-01': 'v5-7'
};

const learningPreview: V2ShopVisual = {
  id: 'learning-preview',
  name: '한결수학',
  category: 'learning',
  relation: 'resident',
  image: V2_REFERENCE_IMAGES.learning,
  desc: '중·고등학생에게 문제를 푸는 이유부터 설명하는 수학 과외입니다.',
  services: '중·고등 수학 · 개념 설명 · 문제 풀이',
  price: '중학생 월 32만원 · 고등학생 상담',
  area: '방림명지로드힐 생활권 · 방문/비대면 가능',
  benefit: '방림명지로드힐 학생 첫 수업 무료',
  availability: '평일 저녁 · 주말 상담',
  color: '#4057E8'
};

const initialShops: V2ShopVisual[] = [
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'food-01')!,
  learningPreview,
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'home-01')!,
  V2_SAMPLE_SHOPS.find((shop) => shop.id === 'pro-01')!,
  ...V2_SAMPLE_SHOPS.filter((shop) => !['food-01', 'home-01', 'pro-01'].includes(shop.id))
].filter(Boolean);

const emptyApplication: BusinessApplicationInput = {
  relationType: 'resident',
  businessName: '',
  categoryName: '과외·수업',
  serviceSummary: '',
  priceText: '',
  contactMethod: '',
  serviceArea: '',
  benefitText: '',
  availabilityText: '상담 후 협의'
};

function relationToVisual(value: RelationType): V2RelationKey {
  if (value === 'resident') return 'resident';
  if (value === 'resident_family') return 'family';
  if (value === 'neighbor') return 'neighbor';
  return 'partner';
}

function categoryForApplication(input: BusinessApplicationInput): V2CategoryKey {
  const text = `${input.categoryName} ${input.serviceSummary}`.toLowerCase();
  if (/수학|과외|수업|교육/.test(text)) return 'learning';
  if (/반찬|음식|카페|요리/.test(text)) return 'food';
  if (/청소|수리|에어컨|정비/.test(text)) return 'home';
  if (/세무|노무|상담|문서/.test(text)) return 'professional';
  return 'creative';
}

function imageForCategory(category: V2CategoryKey) {
  if (category === 'learning') return V2_REFERENCE_IMAGES.learning;
  if (category === 'food') return V2_REFERENCE_IMAGES.food;
  if (category === 'home') return V2_REFERENCE_IMAGES.home;
  if (category === 'professional') return V2_REFERENCE_IMAGES.professional;
  if (category === 'beauty') return V2_REFERENCE_IMAGES.beauty;
  return V2_REFERENCE_IMAGES.photo;
}

function approvedBusinessToVisual(business: Business, application: BusinessApplication): V2ShopVisual {
  const category = categoryForApplication({
    relationType: application.relationType,
    businessName: application.businessName,
    categoryName: application.categoryName,
    serviceSummary: application.serviceSummary,
    priceText: application.priceText,
    contactMethod: application.contactMethod,
    serviceArea: application.serviceArea,
    benefitText: application.benefitText,
    availabilityText: application.availabilityText
  });
  return {
    id: business.id,
    name: business.name,
    category,
    relation: relationToVisual(business.relationType),
    image: imageForCategory(category),
    desc: business.summary || application.serviceSummary,
    services: application.serviceSummary,
    price: business.priceText || application.priceText || '상담 후 안내',
    area: business.serviceArea || application.serviceArea || '방림동과 인근 지역',
    benefit: business.activeBenefit?.title || application.benefitText || '등록된 주민혜택 없음',
    availability: business.availabilityText || application.availabilityText || '상담 후 협의',
    color: category === 'learning' ? '#4057E8' : category === 'food' ? '#E95C3E' : category === 'home' ? '#BDE53E' : category === 'professional' ? '#6840A5' : '#C56A45'
  };
}

function matchesQuery(shop: V2ShopVisual, query: string) {
  if (!query.trim()) return true;
  const haystack = [shop.name, shop.desc, shop.services, shop.price, shop.area, shop.benefit].join(' ').toLowerCase();
  const compact = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return compact.split(' ').every((token) => haystack.includes(token));
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function contactLabel(contact: BusinessContact) {
  return `${{ phone: '전화', sms: '문자', kakao: '카카오톡', url: '온라인' }[contact.type]} · ${contact.value}`;
}

export default function V2IntegratedApp() {
  const [activeNav, setActiveNav] = useState<V2VisualNavKey>('home');
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<V2CategoryKey | 'all'>('all');
  const [relation, setRelation] = useState<V2RelationKey | 'all'>('all');
  const [dynamicShops, setDynamicShops] = useState<V2ShopVisual[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [selectedShop, setSelectedShop] = useState<V2ShopVisual | null>(null);
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [claims, setClaims] = useState<BenefitClaim[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [registrationStep, setRegistrationStep] = useState<1 | 2 | 3 | 4>(1);
  const [registration, setRegistration] = useState<BusinessApplicationInput>({ ...emptyApplication });
  const [activeApplication, setActiveApplication] = useState<BusinessApplication | null>(null);
  const [promoGenerated, setPromoGenerated] = useState(false);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const detailCloseRef = useRef<HTMLButtonElement>(null);
  const profileCloseRef = useRef<HTMLButtonElement>(null);
  const registrationCloseRef = useRef<HTMLButtonElement>(null);
  const operatorCloseRef = useRef<HTMLButtonElement>(null);

  const allShops = useMemo(() => [...initialShops, ...dynamicShops], [dynamicShops]);
  const visibleShops = useMemo(() => allShops.filter((shop) => {
    if (!matchesQuery(shop, query)) return false;
    if (category !== 'all' && shop.category !== category) return false;
    if (relation !== 'all' && shop.relation !== relation) return false;
    return true;
  }), [allShops, category, query, relation]);

  const primaryBenefit = benefits.find((benefit) => benefit.businessId === 'v5-1') ?? benefits[0] ?? null;
  const primaryClaim = primaryBenefit ? claims.find((claim) => claim.benefitId === primaryBenefit.id) ?? null : null;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReducedMotion(media.matches);
    syncMotion();
    media.addEventListener('change', syncMotion);

    let frame = 0;
    const updateProgress = () => {
      frame = 0;
      if (media.matches) {
        setProgress(0);
        return;
      }
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateProgress);
    };
    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      media.removeEventListener('change', syncMotion);
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    void Promise.all([
      dataAdapter.listBenefits().catch(() => [] as Benefit[]),
      dataAdapter.listBenefitClaims().catch(() => [] as BenefitClaim[]),
      dataAdapter.getBookmarks().catch(() => [] as string[])
    ]).then(([benefitRows, claimRows, bookmarks]) => {
      setBenefits(benefitRows);
      setClaims(claimRows);
      const visualIds = Object.entries(adapterIdByVisualId)
        .filter(([, adapterId]) => bookmarks.includes(adapterId))
        .map(([visualId]) => visualId);
      setSavedIds(visualIds);
    });
  }, []);

  useEffect(() => {
    if (detailOpen) detailCloseRef.current?.focus();
  }, [detailOpen]);
  useEffect(() => {
    if (profileOpen) profileCloseRef.current?.focus();
  }, [profileOpen]);
  useEffect(() => {
    if (registrationOpen) registrationCloseRef.current?.focus();
  }, [registrationOpen]);
  useEffect(() => {
    if (operatorOpen) operatorCloseRef.current?.focus();
  }, [operatorOpen]);

  function navigate(key: V2VisualNavKey) {
    setActiveNav(key);
    if (key === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
    if (key === 'shops') scrollToSection('v2-discovery');
    if (key === 'benefits') scrollToSection('v2-benefits');
    if (key === 'news') scrollToSection('v2-ending');
    if (key === 'me') setProfileOpen(true);
  }

  function runSearch(value: string) {
    setQuery(value);
    setActiveNav('shops');
    window.requestAnimationFrame(() => scrollToSection('v2-discovery'));
  }

  async function toggleSave(shop: V2ShopVisual) {
    const isSaved = savedIds.includes(shop.id);
    setSavedIds((current) => isSaved ? current.filter((id) => id !== shop.id) : [...current, shop.id]);
    const adapterId = adapterIdByVisualId[shop.id] ?? shop.id;
    try {
      if (isSaved) await dataAdapter.removeBookmark(adapterId);
      else await dataAdapter.addBookmark(adapterId);
    } catch {
      // V2 comparison preview keeps the visual state local if protected live auth is unavailable.
    }
  }

  function openShop(shop: V2ShopVisual) {
    setSelectedShop(shop);
    setContacts([]);
    setDetailOpen(true);
  }

  function openShopById(id: string) {
    const shop = allShops.find((item) => item.id === id) ?? initialShops.find((item) => item.id === id);
    if (shop) openShop(shop);
  }

  async function revealContacts() {
    if (!selectedShop) return;
    setBusy(true);
    setMessage('');
    try {
      const adapterId = adapterIdByVisualId[selectedShop.id] ?? selectedShop.id;
      setContacts(await dataAdapter.getBusinessContacts(adapterId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '문의 방법은 인증된 입주민만 볼 수 있습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshClaims() {
    setClaims(await dataAdapter.listBenefitClaims().catch(() => claims));
  }

  async function claimResidentBenefit() {
    if (!primaryBenefit) {
      setMessage('현재 연결된 주민혜택이 없습니다.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await dataAdapter.claimBenefit(primaryBenefit.id);
      await refreshClaims();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '주민혜택을 받지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function useResidentBenefit(benefitId: string) {
    setBusy(true);
    setMessage('');
    try {
      await dataAdapter.useBenefit(benefitId);
      await refreshClaims();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '혜택 상태를 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function openRegistration() {
    setRegistration({ ...emptyApplication });
    setRegistrationStep(1);
    setRegistrationOpen(true);
    setPromoGenerated(false);
    setMessage('');
  }

  function updateRegistration<K extends keyof BusinessApplicationInput>(key: K, value: BusinessApplicationInput[K]) {
    setRegistration((current) => ({ ...current, [key]: value }));
  }

  async function submitRegistration(event: FormEvent) {
    event.preventDefault();
    if (!registration.businessName.trim() || !registration.serviceSummary.trim()) {
      setRegistrationStep(2);
      setMessage('이름과 하는 일을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const submitted = await dataAdapter.createBusinessApplication({
        ...registration,
        businessName: registration.businessName.trim(),
        serviceSummary: registration.serviceSummary.trim(),
        categoryName: registration.categoryName.trim() || '과외·수업'
      });
      setActiveApplication(submitted);
      setRegistrationOpen(false);
      setPromoGenerated(false);
      window.requestAnimationFrame(() => scrollToSection('v2-promo'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '등록 신청을 접수하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function approveApplication() {
    if (!activeApplication) return;
    setBusy(true);
    setMessage('');
    try {
      await adminAdapter.reviewApplication(activeApplication.id, 'approved', 'V2 통합 Preview 승인');
      const businesses = await dataAdapter.listBusinesses({ query: activeApplication.businessName });
      const materialized = businesses.find((business) => business.name === activeApplication.businessName);
      if (!materialized) throw new Error('승인된 가게가 기존 Business 목록에 materialize되지 않았습니다.');
      const visual = approvedBusinessToVisual(materialized, activeApplication);
      setDynamicShops((current) => [visual, ...current.filter((shop) => shop.id !== visual.id)]);
      setOperatorOpen(false);
      setQuery('');
      setCategory('all');
      setRelation('all');
      setMessage('승인 완료. 기존 승인 materialization을 거쳐 다시 발견됩니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '운영 승인에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const claimState = primaryClaim?.status ?? 'available';

  return (
    <div data-ui-variant="v2" className="v2-visual-surface v2-integrated-app" data-reduced-motion={reducedMotion || undefined} style={{ '--v2-accent': '#E95C3E' } as React.CSSProperties}>
      <span className="v2-sr-only">모션 줄이기</span>
      <a className="v2-skip" href="#v2-main">본문으로 건너뛰기</a>
      <V2Topbar
        active={activeNav}
        progress={progress}
        onNavigate={navigate}
        onOpenSearch={() => document.getElementById('v2-hero-search')?.focus()}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <main id="v2-main" className="v2-main">
        <V2Hero serviceCount={allShops.length} onSearch={runSearch} onBrowse={() => navigate('shops')} onRegister={openRegistration} />
        <V2CinematicScenes
          reducedMotion={reducedMotion}
          savedShopIds={savedIds}
          onOpenDetail={openShopById}
          onToggleSave={(id) => {
            const shop = allShops.find((item) => item.id === id);
            if (shop) void toggleSave(shop);
          }}
        />

        <section id="v2-discovery" data-v2-section="discovery" className="v2-integration-section v2-discovery-section">
          <div className="v2-section-inner">
            <div className="v2-section-heading">
              <div>
                <div className="v2-kicker">SCENE 03 · 가까운 일부터 발견</div>
                <h2 className="v2-section-title">가까운 사람의 일을 먼저 보여줍니다.</h2>
              </div>
              <p>V2의 시각 기준은 이미지 리프레시 원본을 따르고, 등록·혜택·승인 데이터 흐름은 기존 단지온 adapter 계약을 유지합니다.</p>
            </div>

            <div className="v2-discovery-search" role="search">
              <V2Icon name="search" />
              <label className="v2-sr-only" htmlFor="v2-discovery-search">이웃가게 검색</label>
              <input id="v2-discovery-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가게 이름이나 필요한 일로 다시 검색" />
              {query && <button type="button" onClick={() => setQuery('')}>검색어 지우기</button>}
            </div>

            <V2FilterBar category={category} relation={relation} onCategoryChange={setCategory} onRelationChange={setRelation} />

            <div className="v2-integrated-result-summary"><strong>{visibleShops.length}</strong><span>개의 이웃 일이 보입니다.</span></div>
            <div className="v2-integrated-shop-grid">
              {visibleShops.map((shop) => (
                <article key={shop.id} className="v2-integrated-shop-card" data-shop-id={shop.id}>
                  <button type="button" className="v2-integrated-shop-image" onClick={() => openShop(shop)} aria-label={`${shop.name} 이미지와 상세 보기`}>
                    <V2VisualImage src={shop.image.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={shop.image.alt} fallbackLabel={shop.name} />
                    <span>{V2_RELATION_LABELS[shop.relation]}</span>
                  </button>
                  <div className="v2-integrated-shop-copy">
                    <div><small>{V2_CATEGORY_LABELS[shop.category]}</small><button type="button" aria-pressed={savedIds.includes(shop.id)} aria-label={`${shop.name} 저장`} onClick={() => void toggleSave(shop)}>{savedIds.includes(shop.id) ? '♥' : '♡'}</button></div>
                    <h3>{shop.name}</h3>
                    <p>{shop.desc}</p>
                    <dl><div><dt>이용</dt><dd>{shop.price}</dd></div><div><dt>주민혜택</dt><dd>{shop.benefit}</dd></div></dl>
                    <button type="button" className="v2-btn v2-btn-small" onClick={() => openShop(shop)}>상세보기</button>
                  </div>
                </article>
              ))}
              {!visibleShops.length && <div className="v2-integrated-empty">조건에 맞는 이웃의 일이 없습니다.</div>}
            </div>
          </div>
        </section>

        <section id="v2-benefits" data-v2-section="benefits" className="v2-integration-section v2-integrated-benefits">
          <div className="v2-section-inner v2-benefit-layout">
            <div className="v2-benefit-photo">
              <V2VisualImage src={V2_REFERENCE_IMAGES.food.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt="오늘의 반찬을 준비하는 이웃" fallbackLabel="오늘의 반찬" />
              <div className="v2-benefit-photo-copy"><div className="v2-eyebrow">SCENE 04 · 주민혜택</div><h2>혜택이<br />실제 행동이 됩니다.</h2><p>혜택을 받으면 내정보에서 번호와 사용 상태를 다시 확인할 수 있습니다.</p></div>
            </div>
            <div className="v2-benefit-panel">
              <div className="v2-benefit-card">
                <span className="v2-tag">방림명지로드힐 입주민 전용 · 시연용 예시</span>
                <h3>오늘의 반찬</h3>
                <div className="v2-benefit-big">방림명지로드힐 주민 10% 할인</div>
                <div className="v2-benefit-code"><span>혜택번호</span><strong>{primaryClaim?.code ?? '받기 전'}</strong></div>
                <div className="v2-benefit-status"><span className={`v2-status-dot v2-status-${claimState}`} /><span>{claimState === 'stored' ? '보관 중' : claimState === 'used' ? '사용 완료' : '아직 받지 않은 혜택'}</span></div>
                {claimState === 'available' && <button className="v2-btn v2-btn-accent" type="button" disabled={busy || !primaryBenefit} onClick={() => void claimResidentBenefit()}>주민혜택 받기</button>}
                {claimState === 'stored' && <button className="v2-btn v2-btn-accent" type="button" onClick={() => setProfileOpen(true)}>내정보에서 확인</button>}
                {claimState === 'used' && <button className="v2-btn" type="button" disabled>사용 완료</button>}
              </div>
            </div>
          </div>
        </section>

        <section id="v2-registration" data-v2-section="registration" className="v2-integration-section v2-registration-section">
          <div className="v2-section-inner v2-registration-teaser">
            <div><div className="v2-kicker">SCENE 05 · ROLE SHIFT</div><h2 className="v2-section-title">이번에는 내 일을 알립니다.</h2><p>소비자로 둘러보던 주민이 공급자로 전환되는 순간을 별도의 로그인 역할이 아니라 기존 BusinessApplication 계약으로 연결합니다.</p></div>
            <button type="button" className="v2-btn v2-btn-primary" onClick={openRegistration}>내 일 알리기</button>
          </div>
        </section>

        <section id="v2-promo" data-v2-section="promo" className="v2-integration-section v2-promo-section">
          <div className="v2-section-inner">
            <div className="v2-section-heading">
              <div><div className="v2-kicker">SCENE 06 · PROMOTION</div><h2 className="v2-section-title">입력한 생활정보가 홍보물로 정돈됩니다.</h2></div>
              <p>홍보물은 신청 데이터를 재배치한 브라우저 미리보기입니다. 별도 홍보물 DB나 저장 규칙을 만들지 않습니다.</p>
            </div>
            <div className="v2-promo-control">
              <div><span>현재 신청</span><strong>{activeApplication?.businessName ?? '아직 등록 신청이 없습니다.'}</strong></div>
              <button type="button" className="v2-btn v2-btn-primary" disabled={!activeApplication} onClick={() => setPromoGenerated(true)}>홍보물 만들기</button>
            </div>
            {promoGenerated && activeApplication && (
              <div className="v2-integrated-promo-grid" aria-live="polite">
                <article><small>단지온 가게소개 카드</small><h3>{activeApplication.businessName}</h3><p>{activeApplication.serviceSummary}</p><strong>{activeApplication.benefitText || '등록된 주민혜택 없음'}</strong></article>
                <article><small>카카오톡 공유 이미지</small><h3>우리 단지에<br />{activeApplication.serviceSummary}<br />하는 이웃이 있습니다.</h3><p>{activeApplication.businessName}</p></article>
                <article><small>엘리베이터 게시판 포스터</small><h3>{activeApplication.businessName}</h3><strong>{activeApplication.benefitText || '주민혜택 안내'}</strong><p>{activeApplication.serviceArea || '방림명지로드힐 생활권'}</p></article>
              </div>
            )}
            <div className="v2-promo-next"><button type="button" className="v2-btn" disabled={!promoGenerated || !activeApplication} onClick={() => setOperatorOpen(true)}>운영확인으로 이동</button></div>
          </div>
        </section>

        <section id="v2-ending" data-v2-section="ending" className="v2-integration-section v2-ending-section">
          <div className="v2-section-inner"><div className="v2-kicker">SCENE 07 · CIRCULAR NEIGHBOR ECONOMY</div><h2 className="v2-section-title">우리 단지의 소비가 우리 이웃의 일로 이어집니다.</h2><p>발견 → 혜택 → 등록 → 홍보 → 운영확인 → 다시 발견의 순환을 한 화면에서 확인합니다.</p></div>
        </section>
      </main>

      {detailOpen && selectedShop && (
        <div className="v2-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}>
          <section className="v2-dialog v2-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-detail-dialog-title">
            <button ref={detailCloseRef} type="button" className="v2-dialog-close" onClick={() => setDetailOpen(false)}>닫기</button>
            <div className="v2-detail-dialog-grid">
              <V2VisualImage src={selectedShop.image.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={selectedShop.image.alt} fallbackLabel={selectedShop.name} />
              <div>
                <span className="v2-relation-pill">{V2_RELATION_LABELS[selectedShop.relation]}</span>
                <h2 id="v2-detail-dialog-title">{selectedShop.name}</h2>
                <p>{selectedShop.desc}</p>
                <dl><div><dt>하는 일</dt><dd>{selectedShop.services}</dd></div><div><dt>가격</dt><dd>{selectedShop.price}</dd></div><div><dt>이용 지역</dt><dd>{selectedShop.area}</dd></div><div><dt>주민혜택</dt><dd>{selectedShop.benefit}</dd></div><div><dt>이용 가능</dt><dd>{selectedShop.availability}</dd></div></dl>
                <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void revealContacts()}>문의 방법 보기</button>
                {contacts.length > 0 && <div className="v2-contact-list">{contacts.map((contact, index) => <p key={`${contact.type}-${index}`}>{contactLabel(contact)}</p>)}</div>}
              </div>
            </div>
          </section>
        </div>
      )}

      {profileOpen && (
        <div className="v2-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProfileOpen(false); }}>
          <section className="v2-dialog v2-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-profile-title">
            <button ref={profileCloseRef} type="button" className="v2-dialog-close" onClick={() => setProfileOpen(false)}>닫기</button>
            <span className="v2-eyebrow">MY DANJION</span><h2 id="v2-profile-title">내정보</h2>
            <p>계정 로그인과 입주민 인증은 별도 자격 레이어입니다. 이 Preview는 현재 Auth interface 상태를 그대로 사용합니다.</p>
            <div className="v2-profile-benefits">
              <h3>내 주민혜택</h3>
              {claims.map((claim) => <article key={claim.id}><div><strong>{claim.businessName}</strong><span>{claim.title}</span><code>{claim.code}</code></div><div><b>{claim.status === 'used' ? '사용 완료' : '보관 중'}</b>{claim.status === 'stored' && <button type="button" className="v2-btn v2-btn-small" disabled={busy} onClick={() => void useResidentBenefit(claim.benefitId)}>사용 완료 처리</button>}</div></article>)}
              {!claims.length && <p>아직 받은 혜택이 없습니다.</p>}
            </div>
          </section>
        </div>
      )}

      {registrationOpen && (
        <div className="v2-dialog-backdrop">
          <section className="v2-dialog v2-registration-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-registration-dialog-title">
            <button ref={registrationCloseRef} type="button" className="v2-dialog-close" onClick={() => setRegistrationOpen(false)}>닫기</button>
            <div className="v2-step-label">STEP {registrationStep} / 4</div>
            <form onSubmit={(event) => void submitRegistration(event)}>
              {registrationStep === 1 && <fieldset><legend id="v2-registration-dialog-title">주민 관계를 선택하세요</legend><p>사업 공개정보와 주민 인증자료는 분리해서 다룹니다.</p><label className="v2-choice"><input type="radio" name="relation" checked={registration.relationType === 'resident'} onChange={() => updateRegistration('relationType', 'resident')} />현재 단지 주민 직접 운영</label><label className="v2-choice"><input type="radio" name="relation" checked={registration.relationType === 'resident_family'} onChange={() => updateRegistration('relationType', 'resident_family')} />현재 단지 주민 가족 운영</label><label className="v2-choice"><input type="radio" name="relation" checked={registration.relationType === 'neighbor'} onChange={() => updateRegistration('relationType', 'neighbor')} />이웃 단지 주민 운영</label><label className="v2-choice"><input type="radio" name="relation" checked={registration.relationType === 'local'} onChange={() => updateRegistration('relationType', 'local')} />일반 동네 제휴가게</label></fieldset>}
              {registrationStep === 2 && <fieldset><legend id="v2-registration-dialog-title">기본 정보를 확인하세요</legend><div className="v2-registration-fields"><label>이름 또는 가게명<input value={registration.businessName} onChange={(event) => updateRegistration('businessName', event.target.value)} /></label><label>무슨 일을 하나요?<textarea rows={3} value={registration.serviceSummary} onChange={(event) => updateRegistration('serviceSummary', event.target.value)} /></label><label>가격 또는 상담 기준<input value={registration.priceText || ''} onChange={(event) => updateRegistration('priceText', event.target.value)} /></label><label>이용 지역과 방식<input value={registration.serviceArea || ''} onChange={(event) => updateRegistration('serviceArea', event.target.value)} /></label><label>문의 방식<input value={registration.contactMethod || ''} onChange={(event) => updateRegistration('contactMethod', event.target.value)} /></label></div></fieldset>}
              {registrationStep === 3 && <fieldset><legend id="v2-registration-dialog-title">사진과 주민혜택을 정하세요</legend><div className="v2-registration-photo-preview"><V2VisualImage src={V2_REFERENCE_IMAGES.learning.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt="등록 대표 이미지 예시" fallbackLabel="대표 이미지" /><span>실제 파일 저장은 기존 StorageAdapter 계약을 사용합니다.</span></div><label className="v2-full-label">입주민 혜택<input value={registration.benefitText || ''} onChange={(event) => updateRegistration('benefitText', event.target.value)} /></label></fieldset>}
              {registrationStep === 4 && <fieldset><legend id="v2-registration-dialog-title">공개정보와 비공개 정보를 확인하세요</legend><div className="v2-public-private"><article><span>공개정보 확인</span><h3>{registration.businessName || '가게명'}</h3><p>{registration.serviceSummary || '하는 일'}</p><strong>{registration.priceText || '상담 후 안내'}</strong></article><article><span>비공개 주민관계 확인</span><h3>{registration.relationType === 'resident' ? '현재 단지 주민 직접 운영' : registration.relationType === 'resident_family' ? '현재 단지 주민 가족 운영' : registration.relationType === 'neighbor' ? '이웃 단지 주민 운영' : '일반 동네 제휴가게'}</h3><p>동·호수와 인증 증빙은 공개하지 않습니다.</p></article></div></fieldset>}
              <div className="v2-dialog-actions">
                {registrationStep > 1 && <button type="button" className="v2-btn" onClick={() => setRegistrationStep((registrationStep - 1) as 1 | 2 | 3 | 4)}>이전</button>}
                {registrationStep < 4 && <button type="button" className="v2-btn v2-btn-primary" onClick={() => setRegistrationStep((registrationStep + 1) as 1 | 2 | 3 | 4)}>다음</button>}
                {registrationStep === 4 && <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>등록 검토 요청</button>}
              </div>
            </form>
          </section>
        </div>
      )}

      {operatorOpen && activeApplication && (
        <div className="v2-dialog-backdrop">
          <section className="v2-dialog v2-operator-dialog" role="dialog" aria-modal="true" aria-labelledby="v2-operator-title">
            <button ref={operatorCloseRef} type="button" className="v2-dialog-close" onClick={() => setOperatorOpen(false)}>닫기</button>
            <span className="v2-eyebrow">OPERATOR REVIEW</span><h2 id="v2-operator-title">운영확인</h2>
            <div className="v2-public-private"><article><span>공개정보 확인</span><h3>{activeApplication.businessName}</h3><p>{activeApplication.serviceSummary}</p><strong>{activeApplication.benefitText || '주민혜택 없음'}</strong></article><article><span>비공개 주민관계 확인</span><h3>주민 관계와 인증 경계</h3><p>정확한 동·호수와 증빙 원문은 공개하지 않습니다.</p></article></div>
            <div className="v2-dialog-actions"><button type="button" className="v2-btn" onClick={() => setOperatorOpen(false)}>홍보물로 돌아가기</button><button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void approveApplication()}>승인하여 공개</button></div>
          </section>
        </div>
      )}

      {message && <button type="button" className="v2-integration-toast" onClick={() => setMessage('')}>{message}</button>}
    </div>
  );
}
