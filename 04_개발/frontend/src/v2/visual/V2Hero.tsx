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
  const sideTopImage = V2_REFERENCE_IMAGES.craft;
  const sideBottomImage = V2_REFERENCE_IMAGES.professional;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  return (
    <section data-v2-section="hero" className="v2-hero v2-gate1-hero" aria-labelledby="v2-hero-title">
      <div className="v2-hero-grid v2-gate1-hero-grid">
        <div className="v2-hero-copy v2-gate1-hero-copy">
          <div className="v2-hero-meta v2-gate1-kicker-row">
            <span className="v2-gate1-kicker">DANJION · ROADHILL LIGHTS</span>
            {!API_DATA_MODE && <span className="v2-demo-chip">시연용 데이터</span>}
          </div>

          <h1 className="v2-hero-title v2-gate1-title" id="v2-hero-title">
            <span className="v2-hero-line">우리 아파트에,</span>
            <span className="v2-hero-line">단지온이 <em>켜졌습니다.</em></span>
          </h1>

          <p className="v2-hero-sub v2-gate1-lead">
            같은 단지에 사는 이웃의 일을 발견하고, 주민만의 혜택과 우리 단지 소식을 한곳에서 만납니다.
          </p>

          <div className="v2-hero-actions v2-gate1-actions">
            <button className="v2-btn v2-btn-primary" type="button" onClick={onBrowse}>이웃가게 둘러보기 <V2Icon name="arrow" /></button>
            <button className="v2-btn" type="button" onClick={onRegister}>내 일 알리기</button>
          </div>

          <div className="v2-gate1-trust" aria-label="단지온 가입 원칙">
            <span><i />주민이 직접 가입</span>
            <span><i />주민명부 제공 없음</span>
            <span><i />동·호 비공개</span>
          </div>

          <div className="v2-hero-stat v2-gate1-stat">
            <div><b>{serviceCount}</b><span>현재 공개된 이웃의 일</span></div>
            <p className="v2-hero-mini-note">계정 로그인과 실제 주민권한은 별도입니다. 공통 링크나 동·호 선택만으로 주민권한을 부여하지 않습니다.</p>
          </div>
        </div>

        <div className="v2-hero-photo v2-gate1-stage" aria-label="우리 단지 이웃의 실제 작업 장면">
          <div className="v2-gate1-main-photo">
            <V2VisualImage data-v2-hero-image className="v2-hero-photo-bg" src={heroImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={heroImage.alt} fallbackLabel="오늘의 반찬" />
            <div className="v2-gate1-photo-caption"><small>NEIGHBORS AT WORK</small><b>오늘의 반찬</b></div>
          </div>
          <div className="v2-gate1-side-photo v2-gate1-side-top">
            <V2VisualImage src={sideTopImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={sideTopImage.alt} fallbackLabel="꽃담 공방" />
            <span>만드는 이웃</span>
          </div>
          <div className="v2-gate1-side-photo v2-gate1-side-bottom">
            <V2VisualImage src={sideBottomImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={sideBottomImage.alt} fallbackLabel="바른 세무상담" />
            <span>돕는 이웃</span>
          </div>
          <div className="v2-gate1-light-line" aria-hidden="true" />
          <div className="v2-gate1-vertical" aria-hidden="true">DANJION · {complexName}</div>
        </div>
      </div>

      <div className="v2-gate1-search-band">
        <form className="v2-search-wrap" role="search" onSubmit={submit}>
          <V2Icon name="search" />
          <label className="v2-sr-only" htmlFor="v2-hero-search">무슨 일이 필요하세요?</label>
          <input id="v2-hero-search" className="v2-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="무슨 일이 필요하세요?  반찬 · 과외 · 에어컨 청소 · 세무" autoComplete="off" />
          <button className="v2-search-submit" type="submit">찾기</button>
        </form>
      </div>
    </section>
  );
}
