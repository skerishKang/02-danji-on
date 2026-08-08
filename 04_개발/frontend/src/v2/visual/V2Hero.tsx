import { useState, type FormEvent } from 'react';
import { V2Icon } from './V2Icon';
import { V2VisualImage } from './V2VisualImage';
import { V2_REFERENCE_IMAGES } from './visual-data';

const LOCAL_HERO_FALLBACK = '/field-demo/scenes-sprite.jpg';
const API_DATA_MODE = import.meta.env.VITE_DATA_MODE === 'api';

export function V2Hero({
  serviceCount = 7,
  complexName = '방림명지로드힐',
  onSearch,
  onBrowse,
  onRegister
}: {
  serviceCount?: number;
  complexName?: string;
  onSearch?: (query: string) => void;
  onBrowse?: () => void;
  onRegister?: () => void;
}) {
  const [query, setQuery] = useState('');
  const heroImage = V2_REFERENCE_IMAGES.food;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  return (
    <section data-v2-section="hero" className="v2-hero" aria-labelledby="v2-hero-title">
      <div className="v2-hero-grid">
        <div className="v2-hero-copy">
          <div className="v2-hero-meta">
            {!API_DATA_MODE && <span className="v2-demo-chip">시연용 예시 화면</span>}
            {!API_DATA_MODE && <span className="v2-verified-pill"><span className="v2-verified-dot" />{complexName} 입주민</span>}
            {API_DATA_MODE && <span className="v2-demo-chip">공개 가게 API 화면</span>}
          </div>
          <h1 className="v2-hero-title" id="v2-hero-title">
            <span className="v2-hero-line">필요한 일,</span>
            <span className="v2-hero-line">우리 단지에서 먼저</span>
            <span className="v2-hero-line">찾아보세요</span>
          </h1>
          <p className="v2-hero-sub"><strong>같은 단지에 이런 이웃이 있습니다.</strong><br />반찬, 과외, 청소, 수리부터 전문상담까지 같은 아파트 주민이 하는 가게와 서비스를 소개합니다.</p>
          <form className="v2-search-wrap" role="search" onSubmit={submit}>
            <V2Icon name="search" />
            <label className="v2-sr-only" htmlFor="v2-hero-search">무슨 일이 필요하세요?</label>
            <input id="v2-hero-search" className="v2-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="무슨 일이 필요하세요?  반찬 · 과외 · 에어컨 청소 · 세무" autoComplete="off" />
            <button className="v2-search-submit" type="submit">찾기</button>
          </form>
          <div className="v2-hero-actions">
            <button className="v2-btn v2-btn-primary" type="button" onClick={onBrowse}>가게와 서비스 찾기 <V2Icon name="arrow" /></button>
            <button className="v2-btn" type="button" onClick={onRegister}>내 일 알리기</button>
          </div>
          <div className="v2-hero-stat">
            <div><b>{serviceCount}</b><span>현재 공개된 이웃의 일</span></div>
            <div><b>4단계</b><span>내 일 알리기</span></div>
            <p className="v2-hero-mini-note">실제 동·호수와 인증자료는 공개하지 않습니다. 주민 관계 확인은 서비스 품질 보증을 뜻하지 않습니다.</p>
          </div>
        </div>
        <div className="v2-hero-photo" aria-label="반찬을 만드는 이웃의 작업 장면">
          <V2VisualImage data-v2-hero-image className="v2-hero-photo-bg" src={heroImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={heroImage.alt} fallbackLabel="오늘의 반찬" />
          <div className="v2-hero-foreground" aria-hidden="true"><V2VisualImage src={heroImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt="" fallbackLabel="" /></div>
          <div className="v2-hero-photo-note"><span className="v2-hero-live-dot" /><span><b>오늘의 반찬</b><br /><small>{API_DATA_MODE ? '단지온 대표 장면' : '지금 일하는 이웃 · 시연용 예시'}</small></span></div>
        </div>
      </div>
    </section>
  );
}
