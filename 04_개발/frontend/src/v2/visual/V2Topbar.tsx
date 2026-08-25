import { useState } from 'react';
import { V2CommunityView } from './V2CommunityView';
import { V2Icon, type V2IconName } from './V2Icon';

export type V2VisualNavKey = 'home' | 'shops' | 'benefits' | 'community' | 'me';

const NAV: Array<{ key: V2VisualNavKey; label: string; icon: V2IconName }> = [
  { key: 'home', label: '홈', icon: 'home' },
  { key: 'shops', label: '이웃가게', icon: 'store' },
  { key: 'benefits', label: '혜택', icon: 'benefit' },
  { key: 'community', label: '우리단지', icon: 'news' },
  { key: 'me', label: '내정보', icon: 'me' }
];

export function V2Topbar({
  active = 'home',
  complexName = '방림명지로드힐',
  verified = false,
  progress = 0,
  onNavigate,
  onOpenSearch,
  onOpenProfile
}: {
  active?: V2VisualNavKey;
  complexName?: string;
  verified?: boolean;
  progress?: number;
  onNavigate?: (key: V2VisualNavKey) => void;
  onOpenSearch?: () => void;
  onOpenProfile?: () => void;
}) {
  const [communityOpen, setCommunityOpen] = useState(false);
  const safeProgress = Math.min(1, Math.max(0, progress));

  function navigate(key: V2VisualNavKey) {
    if (key === 'community') setCommunityOpen(true);
    onNavigate?.(key);
  }

  function closeCommunity() {
    setCommunityOpen(false);
    onNavigate?.('home');
  }

  return (
    <>
      <div data-v2-top-progress className="v2-top-progress" aria-hidden="true" style={{ transform: `scaleX(${safeProgress})` }} />
      <header data-v2-topbar className="v2-topbar">
        <div className="v2-topbar-inner">
          <button className="v2-brand" type="button" onClick={() => navigate('home')} aria-label="단지온 홈">
            <span className="v2-wordmark">단지온</span>
            <span className="v2-complex">{complexName}</span>
          </button>
          <nav className="v2-desktop-nav" aria-label="주요 메뉴">
            {NAV.slice(1).map((item) => (
              <button className={active === item.key ? 'v2-nav-link is-active' : 'v2-nav-link'} type="button" key={item.key} onClick={() => navigate(item.key)}>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="v2-header-tools">
            {verified && <span className="v2-verified-pill"><span className="v2-verified-dot" />{complexName} 입주민</span>}
            <button className="v2-icon-btn" type="button" onClick={onOpenSearch} aria-label="검색 열기"><V2Icon name="search" /></button>
            <button className="v2-icon-btn" type="button" onClick={onOpenProfile} aria-label="내정보 열기"><V2Icon name="me" /></button>
          </div>
        </div>
      </header>
      <nav data-v2-mobile-nav className="v2-mobile-nav" aria-label="모바일 주요 메뉴">
        {NAV.map((item) => (
          <button type="button" key={item.key} className={active === item.key ? 'is-active' : ''} onClick={() => navigate(item.key)}>
            <V2Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {communityOpen && <V2CommunityView verified={verified} onClose={closeCommunity} />}
    </>
  );
}
