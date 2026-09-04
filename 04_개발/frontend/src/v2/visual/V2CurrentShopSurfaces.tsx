import { useEffect, useState, type Ref } from 'react';
import { V2FilterBar } from './V2ExplorerPrimitives';
import { V2Icon } from './V2Icon';
import { V2VisualImage } from './V2VisualImage';
import {
  V2_CATEGORY_LABELS,
  V2_RELATION_LABELS,
  type V2CategoryKey,
  type V2RelationKey,
  type V2ShopVisual
} from './visual-data';

const LOCAL_IMAGE_FALLBACK = '/field-demo/scenes-sprite.jpg';

type DetailTab = 'info' | 'services' | 'news' | 'benefits' | 'reviews';

const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'info', label: '정보' },
  { key: 'services', label: '품목·서비스' },
  { key: 'news', label: '소식' },
  { key: 'benefits', label: '혜택' },
  { key: 'reviews', label: '후기' }
];

function initialDetailTab(): DetailTab {
  if (typeof window === 'undefined') return 'info';
  if (window.location.hash === '#reviews') return 'reviews';
  if (window.location.hash === '#benefits') return 'benefits';
  return 'info';
}

function replaceDetailHash(tab: DetailTab) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = tab === 'reviews' || tab === 'benefits' ? tab : '';
  window.history.replaceState(window.history.state, '', url);
}

function ShopCard({
  shop,
  variant,
  saved,
  onOpen,
  onToggleSave
}: {
  shop: V2ShopVisual;
  variant: 'featured' | 'side' | 'catalog';
  saved: boolean;
  onOpen: (shop: V2ShopVisual) => void;
  onToggleSave: (shop: V2ShopVisual) => void;
}) {
  return (
    <article className={`v2-integrated-shop-card v2-008-shop-card v2-008-shop-card-${variant}`} data-shop-id={shop.id}>
      <button
        type="button"
        className="v2-integrated-shop-image v2-008-shop-media"
        onClick={() => onOpen(shop)}
        aria-label={`${shop.name} 이미지와 상세 보기`}
      >
        <V2VisualImage src={shop.image.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={shop.image.alt} fallbackLabel={shop.name} />
        <span className="v2-008-relation-badge">{V2_RELATION_LABELS[shop.relation]}</span>
      </button>
      <div className="v2-integrated-shop-copy v2-008-shop-copy">
        <div className="v2-008-shop-eyeline">
          <small>{V2_CATEGORY_LABELS[shop.category]}</small>
          <button
            type="button"
            className="v2-008-save"
            aria-pressed={saved}
            aria-label={`${shop.name} 저장`}
            onClick={() => onToggleSave(shop)}
          >
            {saved ? '♥' : '♡'}
          </button>
        </div>
        <h3>{shop.name}</h3>
        <p>{shop.desc}</p>
        <div className="v2-008-shop-meta">
          <span>{shop.price}</span>
          <span>{shop.benefit}</span>
        </div>
        <button type="button" className="v2-btn v2-btn-small v2-008-detail-trigger" onClick={() => onOpen(shop)}>상세보기</button>
      </div>
    </article>
  );
}

export function V2CurrentShopDiscovery({
  shops,
  query,
  category,
  relation,
  savedIds,
  publicLoadError,
  privateDataUnavailable,
  apiDataMode,
  onQueryChange,
  onCategoryChange,
  onRelationChange,
  onOpen,
  onToggleSave
}: {
  shops: V2ShopVisual[];
  query: string;
  category: V2CategoryKey | 'all';
  relation: V2RelationKey | 'all';
  savedIds: string[];
  publicLoadError: string;
  privateDataUnavailable: boolean;
  apiDataMode: boolean;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: V2CategoryKey | 'all') => void;
  onRelationChange: (value: V2RelationKey | 'all') => void;
  onOpen: (shop: V2ShopVisual) => void;
  onToggleSave: (shop: V2ShopVisual) => void;
}) {
  const [featured, firstSide, secondSide, ...catalog] = shops;

  return (
    <section id="v2-discovery" data-v2-section="discovery" className="v2-integration-section v2-discovery-section v2-008-shop-discovery" aria-labelledby="v2-008-shop-title">
      <div className="v2-section-inner v2-008-shop-inner">
        <header className="v2-008-shop-intro">
          <div>
            <div className="v2-eyebrow">우리 단지에서 발견하는 생활서비스</div>
            <h2 id="v2-008-shop-title">가까이 사는<br />이웃의 일을 발견합니다.</h2>
            <p>우리 주민이 운영하는 가게와 가까운 생활서비스를 필요한 순간에 쉽고 정확하게 찾아보세요.</p>
          </div>
          <div className="v2-008-service-basis" aria-label="서비스 기준">
            <div><b>우리 주민 가게</b><span>현재 단지 주민이 직접 운영하는 일을 구분해 보여줍니다.</span></div>
            <div><b>주민 가족 가게</b><span>우리 단지 주민의 가족이 운영하는 일을 관계에 맞게 표시합니다.</span></div>
            <div><b>이웃가게</b><span>단지 가까이에서 이용할 수 있는 생활 가게를 함께 찾습니다.</span></div>
          </div>
        </header>

        {publicLoadError && <div className="v2-data-notice" role="alert">가게 정보를 불러오지 못했습니다. {publicLoadError}</div>}
        {apiDataMode && privateDataUnavailable && <div className="v2-data-notice" role="status">공개 가게는 실제 API 데이터를 사용합니다. 저장·문의는 브라우저 로그인 연결 후 활성화됩니다.</div>}

        <div className="v2-008-shop-search" role="search">
          <label htmlFor="v2-discovery-search">
            <V2Icon name="search" />
            <span className="v2-sr-only">이웃가게 검색</span>
            <input
              id="v2-discovery-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="무슨 일이 필요하세요?"
              aria-label="이웃가게 검색"
            />
          </label>
          {query ? <button type="button" onClick={() => onQueryChange('')}>지우기</button> : <span aria-hidden="true">검색</span>}
        </div>

        <div className="v2-008-filter-wrap">
          <V2FilterBar
            category={category}
            relation={relation}
            onCategoryChange={onCategoryChange}
            onRelationChange={onRelationChange}
          />
        </div>

        <div className="v2-008-result-summary" aria-live="polite"><strong>{shops.length}</strong><span>개의 이웃가게가 보입니다.</span></div>

        {featured ? (
          <>
            <div className="v2-008-discovery-stage">
              <ShopCard shop={featured} variant="featured" saved={savedIds.includes(featured.id)} onOpen={onOpen} onToggleSave={onToggleSave} />
              <div className="v2-008-side-list">
                {firstSide && <ShopCard shop={firstSide} variant="side" saved={savedIds.includes(firstSide.id)} onOpen={onOpen} onToggleSave={onToggleSave} />}
                {secondSide && <ShopCard shop={secondSide} variant="side" saved={savedIds.includes(secondSide.id)} onOpen={onOpen} onToggleSave={onToggleSave} />}
              </div>
            </div>

            <div className="v2-008-catalog-head"><h3>이웃가게 전체</h3><span>현재 검색·필터 기준</span></div>
            <div className="v2-integrated-shop-grid v2-008-catalog" aria-label="이웃가게 전체 목록">
              {catalog.map((shop) => (
                <ShopCard key={shop.id} shop={shop} variant="catalog" saved={savedIds.includes(shop.id)} onOpen={onOpen} onToggleSave={onToggleSave} />
              ))}
              {!catalog.length && shops.length <= 3 && <p className="v2-008-catalog-note">현재 조건의 가게는 위 발견 영역에 모두 표시했습니다.</p>}
            </div>
          </>
        ) : (
          <div className="v2-integrated-empty">조건에 맞는 이웃의 일이 없습니다.</div>
        )}
      </div>
    </section>
  );
}

export function V2CurrentShopDetail({
  shop,
  saved,
  contacts,
  busy,
  closeRef,
  onClose,
  onToggleSave,
  onRevealContacts
}: {
  shop: V2ShopVisual;
  saved: boolean;
  contacts: string[];
  busy: boolean;
  closeRef?: Ref<HTMLButtonElement>;
  onClose: () => void;
  onToggleSave: (shop: V2ShopVisual) => void;
  onRevealContacts: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>(initialDetailTab);

  useEffect(() => {
    setTab(initialDetailTab());
  }, [shop.id]);

  function selectTab(next: DetailTab) {
    setTab(next);
    replaceDetailHash(next);
  }

  function close() {
    replaceDetailHash('info');
    onClose();
  }

  return (
    <div className="v2-dialog-backdrop v2-008-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section
        className="v2-dialog v2-detail-dialog v2-008-shop-detail"
        data-shop-id={shop.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-detail-dialog-title"
      >
        <button ref={closeRef} type="button" className="v2-dialog-close" onClick={close}>닫기</button>

        <div className="v2-008-detail-routebar">
          <button type="button" className="v2-008-detail-back" onClick={close}>← 이웃가게</button>
          <div className="v2-008-detail-actions">
            <div data-v2-detail-share-slot />
            <button type="button" className="v2-008-save" aria-pressed={saved} aria-label={`${shop.name} 저장`} onClick={() => onToggleSave(shop)}>{saved ? '♥ 저장됨' : '♡ 저장'}</button>
          </div>
        </div>

        <section className="v2-008-detail-hero" aria-label={`${shop.name} 소개`}>
          <div className="v2-008-detail-image">
            <V2VisualImage src={shop.image.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={shop.image.alt} fallbackLabel={shop.name} />
          </div>
          <div className="v2-008-detail-copy">
            <div className="v2-008-detail-badges"><span>{V2_RELATION_LABELS[shop.relation]}</span><span>{V2_CATEGORY_LABELS[shop.category]}</span></div>
            <h2 id="v2-detail-dialog-title">{shop.name}</h2>
            <p className="v2-008-detail-summary">{shop.desc}</p>
            <div className="v2-008-owner-note"><small>이웃의 일</small><strong>{shop.services}</strong></div>
            <div className="v2-008-detail-primary-actions">
              <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={onRevealContacts}>문의 방법 보기</button>
            </div>
            {contacts.length > 0 && <div className="v2-contact-list" aria-label="문의 방법">{contacts.map((contact, index) => <p key={`${contact}-${index}`}>{contact}</p>)}</div>}
          </div>
        </section>

        <nav className="v2-008-detail-tabs" aria-label="가게 상세 메뉴">
          {DETAIL_TABS.map((item) => (
            <button key={item.key} type="button" data-tab={item.key} className={tab === item.key ? 'is-active' : ''} aria-pressed={tab === item.key} onClick={() => selectTab(item.key)}>{item.label}</button>
          ))}
        </nav>

        <div className="v2-008-detail-panels">
          {tab === 'info' && (
            <section className="v2-008-detail-panel" id="info" aria-label="가게 정보">
              <div className="v2-008-panel-heading"><h3>방문 전 확인하세요</h3><span>공개 가게 정보 기준</span></div>
              <dl className="v2-008-info-grid">
                <div><dt>이용 가능</dt><dd>{shop.availability}</dd></div>
                <div><dt>이용 지역</dt><dd>{shop.area}</dd></div>
                <div><dt>문의</dt><dd>정확한 연락처는 기존 주민·세션 권한 확인 후 안내합니다.</dd></div>
              </dl>
            </section>
          )}
          {tab === 'services' && (
            <section className="v2-008-detail-panel" id="services" aria-label="품목과 서비스">
              <div className="v2-008-panel-heading"><h3>품목·서비스</h3><span>가게가 공개한 범위</span></div>
              <p className="v2-008-panel-lead">{shop.services}</p>
              <dl className="v2-008-info-grid"><div><dt>가격·상담 기준</dt><dd>{shop.price}</dd></div><div><dt>이용 방식</dt><dd>{shop.availability}</dd></div></dl>
            </section>
          )}
          {tab === 'news' && (
            <section className="v2-008-detail-panel" id="news" aria-label="가게 소식">
              <div className="v2-008-panel-heading"><h3>소식</h3><span>별도 소식을 꾸며내지 않습니다.</span></div>
              <p className="v2-008-panel-lead">{shop.desc}</p>
              <p>현재 연결된 제품 계약에 별도 가게 소식 피드가 없으면 공개 가게 정보만 표시합니다.</p>
            </section>
          )}
          {tab === 'benefits' && (
            <section className="v2-008-detail-panel" id="benefits" aria-label="가게 혜택">
              <div className="v2-008-panel-heading"><h3>혜택</h3><span>가게 상세 정보</span></div>
              <p className="v2-008-benefit-copy">{shop.benefit}</p>
              <p>혜택 받기·보관·사용 흐름은 별도 주민혜택 화면의 기존 서버 계약을 그대로 사용합니다.</p>
            </section>
          )}
          {tab === 'reviews' && (
            <section className="v2-008-detail-panel" id="reviews" aria-label="가게 후기">
              <div className="v2-008-panel-heading"><h3>후기</h3><span>입주민 권한 기반</span></div>
              <div data-v2-business-reviews-slot />
            </section>
          )}
        </div>

        <div className="v2-008-detail-mobile-actions" aria-label="모바일 가게 동작">
          <button type="button" aria-pressed={saved} onClick={() => onToggleSave(shop)}>{saved ? '저장됨' : '저장'}</button>
          <button type="button" disabled={busy} onClick={onRevealContacts}>문의 방법 보기</button>
        </div>
      </section>
    </div>
  );
}
