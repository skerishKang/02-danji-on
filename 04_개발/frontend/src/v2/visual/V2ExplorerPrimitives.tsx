import type { CSSProperties, ReactNode } from 'react';
import { V2Icon } from './V2Icon';
import { V2VisualImage } from './V2VisualImage';
import {
  V2_CATEGORY_LABELS,
  V2_RELATION_LABELS,
  type V2CategoryKey,
  type V2RelationKey,
  type V2ShopVisual
} from './visual-data';

export type V2ShopCardVariant = 'featured' | 'medium' | 'row';

export function V2SectionHeading({ kicker, title, description, action }: { kicker?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="v2-section-heading">
      <div>{kicker && <div className="v2-kicker">{kicker}</div>}<h2 className="v2-section-title">{title}</h2></div>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function V2FilterBar({
  category = 'all',
  relation = 'all',
  onCategoryChange,
  onRelationChange
}: {
  category?: V2CategoryKey | 'all';
  relation?: V2RelationKey | 'all';
  onCategoryChange?: (category: V2CategoryKey | 'all') => void;
  onRelationChange?: (relation: V2RelationKey | 'all') => void;
}) {
  const categories: Array<V2CategoryKey | 'all'> = ['all', 'food', 'learning', 'home', 'professional', 'creative'];
  const relations: Array<V2RelationKey | 'all'> = ['all', 'resident', 'family', 'neighbor', 'partner'];
  return (
    <div className="v2-filter-zone" aria-label="이웃가게 필터">
      <div className="v2-filter-row"><span className="v2-filter-label">분야</span>{categories.map((key) => <button key={key} type="button" className="v2-filter-btn" aria-pressed={category === key} onClick={() => onCategoryChange?.(key)}>{key === 'all' ? '전체' : V2_CATEGORY_LABELS[key]}</button>)}</div>
      <div className="v2-filter-row"><span className="v2-filter-label">주민 관계</span>{relations.map((key) => <button key={key} type="button" className="v2-filter-btn" aria-pressed={relation === key} onClick={() => onRelationChange?.(key)}>{key === 'all' ? '전체' : ({ resident: '우리 단지 주민', family: '주민 가족', neighbor: '이웃 단지', partner: '일반 제휴' } as const)[key]}</button>)}</div>
    </div>
  );
}

export function V2ShopVisualCard({
  shop,
  variant = 'medium',
  bookmarked = false,
  onOpen,
  onBookmark
}: {
  shop: V2ShopVisual;
  variant?: V2ShopCardVariant;
  bookmarked?: boolean;
  onOpen?: (shop: V2ShopVisual) => void;
  onBookmark?: (shop: V2ShopVisual) => void;
}) {
  return (
    <article className={`v2-shop-card v2-shop-${variant}`} style={{ '--v2-card-accent': shop.color } as CSSProperties}>
      <button className="v2-shop-media" type="button" onClick={() => onOpen?.(shop)} aria-label={`${shop.name} 상세 보기`}>
        <V2VisualImage src={shop.image.src} alt={shop.image.alt} fallbackLabel={shop.name} />
        <span className="v2-shop-rank">{V2_RELATION_LABELS[shop.relation]}</span>
        <span className="v2-shop-example">시연용 예시</span>
      </button>
      <div className="v2-shop-body">
        <div className="v2-shop-topline"><div><b className="v2-shop-name">{shop.name}</b><div className="v2-relation">{V2_RELATION_LABELS[shop.relation]}</div></div><button className="v2-shop-heart" type="button" aria-label={`${shop.name} 저장`} aria-pressed={bookmarked} onClick={() => onBookmark?.(shop)}><V2Icon name="heart" /></button></div>
        <p className="v2-shop-desc">{shop.desc}</p>
        <div className="v2-shop-meta"><span>{shop.services}</span><span>{shop.price}</span><span>{shop.benefit}</span></div>
        <div className="v2-shop-actions"><button className="v2-btn v2-btn-small" type="button" onClick={() => onOpen?.(shop)}>자세히 보기</button></div>
      </div>
    </article>
  );
}

export function V2TextShopRow({ shop, index, onOpen }: { shop: V2ShopVisual; index: number; onOpen?: (shop: V2ShopVisual) => void }) {
  return (
    <div className="v2-text-shop">
      <span className="v2-text-shop-number">{String(index + 1).padStart(2, '0')}</span>
      <b>{shop.name}</b>
      <span>{shop.services}</span>
      <button className="v2-btn v2-btn-small" type="button" onClick={() => onOpen?.(shop)}>보기</button>
    </div>
  );
}

export function V2ExplorerGrid({ shops, onOpen, onBookmark, bookmarkedIds = [] }: { shops: V2ShopVisual[]; onOpen?: (shop: V2ShopVisual) => void; onBookmark?: (shop: V2ShopVisual) => void; bookmarkedIds?: string[] }) {
  const [first, second, ...rest] = shops;
  return (
    <div className="v2-shop-grid">
      {first && <V2ShopVisualCard shop={first} variant="featured" onOpen={onOpen} onBookmark={onBookmark} bookmarked={bookmarkedIds.includes(first.id)} />}
      {second && <V2ShopVisualCard shop={second} variant="medium" onOpen={onOpen} onBookmark={onBookmark} bookmarked={bookmarkedIds.includes(second.id)} />}
      {rest.slice(0, 4).map((shop) => <V2ShopVisualCard key={shop.id} shop={shop} variant="row" onOpen={onOpen} onBookmark={onBookmark} bookmarked={bookmarkedIds.includes(shop.id)} />)}
      {rest.length > 4 && <div className="v2-text-list">{rest.slice(4).map((shop, index) => <V2TextShopRow key={shop.id} shop={shop} index={index + 6} onOpen={onOpen} />)}</div>}
    </div>
  );
}
