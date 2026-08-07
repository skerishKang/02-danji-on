import { useEffect, useMemo, useState } from 'react';
import ApplicationForm from './ApplicationForm';
import { dataAdapter } from './api/adapter';
import {
  applicationStatusLabels,
  relationLabels,
  type Benefit,
  type Business,
  type BusinessApplication,
  type BusinessApplicationInput,
  type BusinessContact,
  type ComplexPost,
  type RelationType
} from './types';

type View = 'home' | 'listings' | 'detail' | 'benefits' | 'news' | 'my' | 'register';
type NavItem = { view: Exclude<View, 'detail' | 'register'>; label: string; icon: string };

const navItems: NavItem[] = [
  { view: 'home', label: '홈', icon: '⌂' },
  { view: 'listings', label: '가게·서비스', icon: '▦' },
  { view: 'benefits', label: '주민혜택', icon: '◇' },
  { view: 'news', label: '단지소식', icon: '≡' },
  { view: 'my', label: '내정보', icon: '○' }
];

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(date);
}

function contactTypeLabel(type: BusinessContact['type']) {
  return { phone: '전화', sms: '문자', kakao: '카카오톡', url: '온라인' }[type];
}

function applicationToInput(application: BusinessApplication): BusinessApplicationInput {
  return {
    relationType: application.relationType,
    businessName: application.businessName,
    categoryName: application.categoryName,
    serviceSummary: application.serviceSummary,
    priceText: application.priceText,
    contactMethod: application.contactMethod,
    serviceArea: application.serviceArea,
    benefitText: application.benefitText,
    availabilityText: application.availabilityText,
    representativeImageObjectKey: application.representativeImageObjectKey
  };
}

function ServiceCard({
  business,
  bookmarked,
  onOpen,
  onBookmark
}: {
  business: Business;
  bookmarked: boolean;
  onOpen: () => void;
  onBookmark: () => void;
}) {
  return (
    <article className="service-card">
      <button className="service-visual" onClick={onOpen} aria-label={`${business.name} 상세 보기`}>
        <span className="service-icon" aria-hidden="true">{business.icon}</span>
        <span className="service-visual-label">{business.kind === 'shop' ? '가게' : '서비스'}</span>
      </button>
      <div className="service-body">
        <div className="service-topline">
          <span className={`relation-chip relation-${business.relationType}`}>{relationLabels[business.relationType]}</span>
          <button className={`bookmark ${bookmarked ? 'active' : ''}`} onClick={onBookmark} aria-label="찜하기">
            {bookmarked ? '♥' : '♡'}
          </button>
        </div>
        <button className="service-copy" onClick={onOpen}>
          <strong>{business.name}</strong>
          <span>{business.summary}</span>
        </button>
        <div className="service-meta">
          <b>{business.priceText}</b>
          {business.activeBenefit && <span>{business.activeBenefit.title}</span>}
        </div>
      </div>
    </article>
  );
}

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [posts, setPosts] = useState<ComplexPost[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [applications, setApplications] = useState<BusinessApplication[]>([]);
  const [editingApplication, setEditingApplication] = useState<BusinessApplication | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [contacts, setContacts] = useState<BusinessContact[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [relation, setRelation] = useState<RelationType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      dataAdapter.listBusinesses(),
      dataAdapter.listBenefits(),
      dataAdapter.listPosts(),
      dataAdapter.getBookmarks().catch(() => []),
      dataAdapter.listMyBusinessApplications().catch(() => [])
    ]).then(([nextBusinesses, nextBenefits, nextPosts, nextBookmarks, nextApplications]) => {
      if (!alive) return;
      setAllBusinesses(nextBusinesses);
      setBusinesses(nextBusinesses);
      setBenefits(nextBenefits);
      setPosts(nextPosts);
      setBookmarks(new Set(nextBookmarks));
      setApplications(nextApplications);
    }).catch((error) => {
      if (!alive) return;
      setMessage(error instanceof Error ? error.message : '데이터를 불러오지 못했습니다.');
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const categories = useMemo(() => {
    const unique = new Map<string, string>();
    allBusinesses.forEach((business) => unique.set(business.categorySlug, business.categoryName));
    return [...unique.entries()];
  }, [allBusinesses]);

  const residentBusinesses = allBusinesses.filter((business) => business.relationType === 'resident').slice(0, 4);
  const bookmarkedBusinesses = allBusinesses.filter((business) => bookmarks.has(business.id));

  async function applyFilters(next?: Partial<{ query: string; category: string; relation: RelationType | 'all' }>) {
    const nextQuery = next?.query ?? query;
    const nextCategory = next?.category ?? category;
    const nextRelation = next?.relation ?? relation;
    setLoading(true);
    try {
      const rows = await dataAdapter.listBusinesses({ query: nextQuery, category: nextCategory, relation: nextRelation });
      setBusinesses(rows);
      setQuery(nextQuery);
      setCategory(nextCategory);
      setRelation(nextRelation);
      setView('listings');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '검색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function resetListings() {
    setLoading(true);
    try {
      const rows = await dataAdapter.listBusinesses();
      setAllBusinesses(rows);
      setBusinesses(rows);
      setQuery('');
      setCategory('all');
      setRelation('all');
      setView('listings');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function openBusiness(id: string) {
    setLoading(true);
    setContacts([]);
    try {
      const business = await dataAdapter.getBusiness(id);
      if (!business) {
        setMessage('가게 정보를 찾을 수 없습니다.');
        return;
      }
      setSelectedBusiness(business);
      setView('detail');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상세 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleBookmark(id: string) {
    const next = new Set(bookmarks);
    try {
      if (next.has(id)) {
        await dataAdapter.removeBookmark(id);
        next.delete(id);
        setMessage('찜을 해제했습니다.');
      } else {
        await dataAdapter.addBookmark(id);
        next.add(id);
        setMessage('찜한 가게에 담았습니다.');
      }
      setBookmarks(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '찜 상태를 변경하지 못했습니다.');
    }
  }

  async function revealContacts() {
    if (!selectedBusiness) return;
    setLoading(true);
    try {
      const rows = await dataAdapter.getBusinessContacts(selectedBusiness.id);
      setContacts(rows);
      setMessage(rows.length ? '인증 주민용 문의 방법을 확인했습니다.' : '등록된 문의 방법이 없습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '문의 방법을 확인하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function submitApplication(input: BusinessApplicationInput) {
    setSubmittingApplication(true);
    try {
      if (editingApplication) {
        const updated = await dataAdapter.resubmitBusinessApplication(editingApplication.id, input);
        const latest = await dataAdapter.listMyBusinessApplications().catch(() => applications.map((item) => item.id === updated.id ? updated : item));
        setApplications(latest);
        setEditingApplication(null);
        setView('my');
        setMessage('보완 내용을 다시 제출했습니다. 신청 상태가 확인 대기로 변경되었습니다.');
      } else {
        const created = await dataAdapter.createBusinessApplication(input);
        const latest = await dataAdapter.listMyBusinessApplications().catch(() => [created, ...applications.filter((item) => item.id !== created.id)]);
        setApplications(latest);
        setView('my');
        setMessage('등록 신청이 접수되었습니다. 내정보에서 상태를 확인할 수 있습니다.');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (editingApplication ? '보완 내용 재제출에 실패했습니다.' : '등록 신청에 실패했습니다.'));
      throw error;
    } finally {
      setSubmittingApplication(false);
    }
  }

  async function beginApplicationResubmit(application: BusinessApplication) {
    setLoading(true);
    setMessage('');
    try {
      const detail = await dataAdapter.getMyBusinessApplication(application.id);
      if (!detail) {
        setMessage('등록 신청을 찾을 수 없습니다.');
        return;
      }
      if (detail.status !== 'changes_requested') {
        setMessage('보완 요청 상태의 신청만 수정할 수 있습니다.');
        return;
      }
      setEditingApplication(detail);
      setView('register');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '보완할 신청을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function go(next: View) {
    setView(next);
    setMessage('');
    if (next !== 'detail') setContacts([]);
    if (next !== 'register') setEditingApplication(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHome() {
    return (
      <>
        <section className="hero shell">
          <div className="hero-copy">
            <span className="eyebrow">방림명지로드힐 단지온</span>
            <h1>필요한 일,<br />우리 단지에서 찾아보세요</h1>
            <p>같은 아파트 주민이 운영하는 가게와 서비스를 먼저 발견하고, 입주민 전용 혜택까지 확인합니다.</p>
            <div className="verified-row">
              <span className="verified">✓ 방림명지로드힐 인증 입주민</span>
              <button className="text-button" onClick={() => go('my')}>인증 정보 보기</button>
            </div>
          </div>
          <div className="hero-scene" aria-label="이웃의 생활 서비스 장면">
            <span className="scene-big">우리 단지 안에도<br />다양한 이웃의 일이 있습니다.</span>
            <div className="scene-people" aria-hidden="true">👩‍🍳　🧑‍🔧　👩‍🏫</div>
            <span className="scene-caption">LIVING NEIGHBOR SHOP</span>
          </div>
        </section>

        <section className="notice-strip shell">
          <span>관리사무소 안내</span>
          <strong>{posts[0]?.title || '단지소식을 준비하고 있습니다.'}</strong>
          <button onClick={() => go('news')}>내용 보기</button>
        </section>

        <section className="search-area shell">
          <label htmlFor="home-search">어떤 가게나 서비스가 필요하세요?</label>
          <div className="search-box">
            <input id="home-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void applyFilters({ query: event.currentTarget.value, category: 'all', relation: 'all' })} placeholder="예: 반찬, 에어컨 청소, 수학 과외" />
            <button className="primary" onClick={() => void applyFilters({ query, category: 'all', relation: 'all' })}>검색하기</button>
          </div>
          <div className="quick-searches">
            {['반찬', '자동차 정비', '에어컨 청소', '수학 과외', '세무 상담', '사진 촬영'].map((item) => <button key={item} onClick={() => void applyFilters({ query: item, category: 'all', relation: 'all' })}>{item}</button>)}
          </div>
        </section>

        <section className="menu-grid shell">
          <button onClick={() => void applyFilters({ query: '', category: 'all', relation: 'resident' })}><span>🏪</span><strong>주민 가게</strong><small>같은 단지 주민이 운영하는 매장</small></button>
          <button onClick={() => void applyFilters({ query: '', category: 'all', relation: 'resident' })}><span>🧰</span><strong>주민 서비스</strong><small>과외·수리·상담·방문 서비스</small></button>
          <button onClick={() => go('benefits')}><span>🎁</span><strong>주민 혜택</strong><small>인증 주민만 받는 할인과 서비스</small></button>
          <button onClick={() => { setEditingApplication(null); go('register'); }}><span>📣</span><strong>내 일 알리기</strong><small>주민 사업자 등록 신청</small></button>
        </section>

        <section className="content-section shell">
          <SectionHeading title="방림명지로드힐 주민의 가게와 서비스" description="같은 단지에 사는 이웃이 직접 운영합니다." action={<button className="section-link" onClick={() => void resetListings()}>모두 보기</button>} />
          <div className="service-grid">
            {residentBusinesses.map((business) => <ServiceCard key={business.id} business={business} bookmarked={bookmarks.has(business.id)} onOpen={() => void openBusiness(business.id)} onBookmark={() => void toggleBookmark(business.id)} />)}
          </div>
        </section>

        <section className="content-section shell">
          <SectionHeading title="이번 주 주민혜택" description="방림명지로드힐 인증 입주민에게 제공됩니다." action={<button className="section-link" onClick={() => go('benefits')}>모두 보기</button>} />
          <div className="benefit-grid">
            {benefits.slice(0, 3).map((benefit) => <button key={benefit.id} className="benefit-card" onClick={() => void openBusiness(benefit.businessId)}><span>🎁</span><div><strong>{benefit.title}</strong><b>{benefit.businessName}</b><p>{benefit.description}</p></div></button>)}
          </div>
        </section>

        <section className="content-section shell">
          <SectionHeading title="단지소식" description="꼭 필요한 소식만 간단히 확인하세요." action={<button className="section-link" onClick={() => go('news')}>모두 보기</button>} />
          <div className="news-list">
            {posts.slice(0, 3).map((post) => <button key={post.id} onClick={() => go('news')}><span>{post.sourceName}</span><strong>{post.title}</strong><time>{formatDate(post.publishedAt)}</time></button>)}
          </div>
        </section>
      </>
    );
  }

  function renderListings() {
    return (
      <section className="page shell">
        <SectionHeading title="가게와 서비스" description="우리 단지 주민 운영을 먼저 보여드리고, 이웃 단지와 동네 가게 순으로 안내합니다." />
        <div className="filter-panel">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="가게·서비스 검색" />
          <select value={relation} onChange={(event) => setRelation(event.target.value as RelationType | 'all')}>
            <option value="all">관계 전체</option><option value="resident">방림명지로드힐 주민 운영</option><option value="resident_family">주민 가족 운영</option><option value="neighbor">이웃 단지 주민 운영</option><option value="local">우리 동네 가게</option>
          </select>
          <button className="primary" onClick={() => void applyFilters()}>검색</button>
        </div>
        <div className="listing-layout">
          <aside className="category-list">
            <button className={category === 'all' ? 'active' : ''} onClick={() => void applyFilters({ category: 'all' })}>전체</button>
            {categories.map(([slug, name]) => <button key={slug} className={category === slug ? 'active' : ''} onClick={() => void applyFilters({ category: slug })}>{name}</button>)}
          </aside>
          <div>
            <div className="result-summary"><strong>{businesses.length}개의 가게와 서비스</strong><span>주민 관계 순서로 표시됩니다.</span></div>
            {businesses.length ? <div className="service-grid">{businesses.map((business) => <ServiceCard key={business.id} business={business} bookmarked={bookmarks.has(business.id)} onOpen={() => void openBusiness(business.id)} onBookmark={() => void toggleBookmark(business.id)} />)}</div> : <div className="empty">조건에 맞는 결과가 없습니다.</div>}
          </div>
        </div>
      </section>
    );
  }

  function renderDetail() {
    const business = selectedBusiness;
    if (!business) return <div className="page shell empty">선택된 가게가 없습니다.</div>;
    return (
      <section className="page shell detail-page">
        <button className="back" onClick={() => go('listings')}>← 가게와 서비스</button>
        <div className="detail-grid">
          <div className="detail-visual"><span>{business.icon}</span><small>실제 서비스에서는 등록된 작업·상품 사진이 표시됩니다.</small></div>
          <div className="detail-copy">
            <span className={`relation-chip relation-${business.relationType}`}>{relationLabels[business.relationType]}</span>
            <h1>{business.name}</h1>
            <p className="lead">{business.summary}</p>
            <strong className="detail-price">{business.priceText}</strong>
            {business.activeBenefit && <div className="detail-benefit"><b>주민 혜택</b><strong>{business.activeBenefit.title}</strong><span>{business.activeBenefit.description}</span></div>}
            <dl>
              <div><dt>분야</dt><dd>{business.categoryName}</dd></div><div><dt>이용 지역</dt><dd>{business.serviceArea}</dd></div><div><dt>이용 시간</dt><dd>{business.availabilityText}</dd></div><div><dt>연락 방법</dt><dd>인증 입주민에게만 실제 연락처를 표시합니다.</dd></div>
            </dl>
            <div className="detail-actions">
              <button className="secondary" onClick={() => void toggleBookmark(business.id)}>{bookmarks.has(business.id) ? '♥ 찜한 가게' : '♡ 찜하기'}</button>
              <button className="primary" onClick={() => void revealContacts()}>문의 방법 보기</button>
            </div>
            {contacts.length > 0 && <div className="contact-panel"><strong>인증 주민용 문의 방법</strong><div className="contact-list">{contacts.map((contact, index) => <span key={`${contact.type}-${index}`}>{contactTypeLabel(contact.type)} · {contact.value}</span>)}</div></div>}
          </div>
        </div>
        <div className="story-card"><h2>이웃이 소개하는 서비스</h2><p>{business.description}</p></div>
      </section>
    );
  }

  function renderBenefits() {
    return <section className="page shell"><SectionHeading title="주민혜택" description="방림명지로드힐 인증 입주민에게 제공되는 혜택입니다." /><div className="benefit-grid benefit-page-grid">{benefits.map((benefit) => <button key={benefit.id} className="benefit-card" onClick={() => void openBusiness(benefit.businessId)}><span>🎁</span><div><strong>{benefit.title}</strong><b>{benefit.businessName}</b><p>{benefit.description}</p></div></button>)}</div><div className="info-box"><strong>혜택 이용 방법</strong><p>가게 방문 또는 서비스 신청 시 단지온의 인증 입주민 화면을 확인하는 흐름을 기준으로 설계합니다.</p></div></section>;
  }

  function renderNews() {
    return <section className="page shell"><SectionHeading title="단지소식" description="입주자대표회의와 관리사무소 등의 필요한 소식을 읽기 쉽게 모았습니다." /><div className="news-page-list">{posts.map((post) => <article key={post.id}><div><span>{post.category}</span><time>{formatDate(post.publishedAt)}</time></div><h2>{post.title}</h2><strong>{post.sourceName}</strong><p>{post.body}</p></article>)}</div></section>;
  }

  function renderMy() {
    return (
      <section className="page shell">
        <SectionHeading title="내정보" description="입주민 인증, 찜한 가게와 내 가게 등록을 관리합니다." />
        <div className="my-grid">
          <article><h2>방림명지로드힐 인증 입주민</h2><p>정확한 동·호수는 다른 주민에게 공개하지 않습니다.</p><span className="verified">✓ 인증 완료 · 개발 기준 UI</span></article>
          <article><h2>찜한 가게</h2><strong className="big-number">{bookmarks.size}</strong><p>나중에 다시 보고 싶은 가게와 서비스입니다.</p></article>
          <article className="wide"><h2>찜 목록</h2>{bookmarkedBusinesses.length ? <div className="bookmark-list">{bookmarkedBusinesses.map((business) => <button key={business.id} onClick={() => void openBusiness(business.id)}>{business.icon} {business.name}</button>)}</div> : <p>아직 찜한 가게가 없습니다.</p>}</article>
          <article className="wide">
            <h2>내 가게·서비스 등록</h2>
            <p>신청 후 관리자가 확인하며, 승인 전에는 주민 화면에 공개되지 않습니다.</p>
            <button className="secondary" onClick={() => { setEditingApplication(null); go('register'); }}>새 등록 신청</button>
            {applications.length ? <div className="application-list">{applications.map((application) => <div className="application-item" key={application.id}><div><strong>{application.businessName}</strong><p>{application.categoryName} · {application.serviceSummary}</p></div><span className={`application-status ${application.status}`}>{applicationStatusLabels[application.status]}</span>{application.reviewNote && <div className="application-note">관리자 메모: {application.reviewNote}</div>}{application.status === 'changes_requested' && <button className="application-resubmit" onClick={() => void beginApplicationResubmit(application)}>보완하기</button>}</div>)}</div> : <p>아직 등록 신청이 없습니다.</p>}
          </article>
          <article><h2>화면 설정</h2><p>큰 글자·모션 감소 같은 개인 화면 설정은 서버 권한과 분리합니다.</p></article>
        </div>
      </section>
    );
  }

  function renderRegister() {
    return <div className="shell"><ApplicationForm categoryNames={categories.map(([, name]) => name)} busy={submittingApplication} onSubmit={submitApplication} onCancel={() => go('my')} initialValue={editingApplication ? applicationToInput(editingApplication) : undefined} mode={editingApplication ? 'resubmit' : 'create'} reviewNote={editingApplication?.reviewNote} /></div>;
  }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="shell topbar-inner"><button className="wordmark" onClick={() => go('home')}>단지온</button><nav className="desktop-nav" aria-label="주요 메뉴">{navItems.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => item.view === 'listings' ? void resetListings() : go(item.view)}>{item.label}</button>)}</nav><span className="complex-pill">방림명지로드힐</span></div></header>

      <main>
        {loading && <div className="loading">데이터를 불러오는 중입니다.</div>}
        {view === 'home' && renderHome()}{view === 'listings' && renderListings()}{view === 'detail' && renderDetail()}{view === 'benefits' && renderBenefits()}{view === 'news' && renderNews()}{view === 'my' && renderMy()}{view === 'register' && renderRegister()}
      </main>

      <footer className="footer shell"><strong>단지온</strong><span>같은 아파트 주민의 가게와 서비스를 먼저 발견하는 생활경제 플랫폼</span><small>현재 개발 브랜치는 v5 기능·정보구조를 제품 코드로 이식하는 단계입니다.</small></footer>
      <nav className="mobile-nav" aria-label="모바일 주요 메뉴">{navItems.map((item) => <button key={item.view} className={view === item.view ? 'active' : ''} onClick={() => item.view === 'listings' ? void resetListings() : go(item.view)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      {message && <button className="toast" onClick={() => setMessage('')}>{message}</button>}
    </div>
  );
}
