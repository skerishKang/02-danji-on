import { useState, type FormEvent } from 'react';
import { V2Gate1Onboarding, V2Gate1ProjectStory } from './V2Gate1Onboarding';
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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [projectStoryOpen, setProjectStoryOpen] = useState(false);
  const heroImage = V2_REFERENCE_IMAGES.food;
  const sideTopImage = V2_REFERENCE_IMAGES.craft;
  const sideBottomImage = V2_REFERENCE_IMAGES.professional;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  function finishOnboarding() {
    window.requestAnimationFrame(() => onBrowse?.());
  }

  return (
    <>
      <section data-v2-section="hero" className="v2-hero v2-gate1-hero" aria-labelledby="v2-hero-title">
        <div className="v2-hero-grid v2-gate1-hero-grid">
          <div className="v2-hero-copy v2-gate1-hero-copy">
            <div className="v2-hero-meta v2-gate1-kicker-row">
              <span className="v2-gate1-kicker">BANGNIM · ROADHILL · 2026</span>
              {!API_DATA_MODE && <span className="v2-demo-chip">React UI Preview</span>}
            </div>

            <h1 className="v2-hero-title v2-gate1-title" id="v2-hero-title">
              <span className="v2-hero-line">우리 아파트에,</span>
              <span className="v2-hero-line">단지온이 <em>켜졌습니다.</em></span>
            </h1>

            <p className="v2-hero-sub v2-gate1-lead">
              같은 아파트에 사는 이웃의 일을 발견하고, 주민만의 혜택과 우리 단지 소식을 한곳에서 만납니다.
            </p>

            <div className="v2-hero-actions v2-gate1-actions">
              <button className="v2-btn v2-btn-primary" type="button" onClick={() => setOnboardingOpen(true)}>가입하고 시작하기 <V2Icon name="arrow" /></button>
              <button className="v2-btn" type="button" onClick={onBrowse}>먼저 둘러보기</button>
            </div>

            <div className="v2-gate1-trust" aria-label="단지온 가입 원칙">
              <span><i />주민이 직접 가입</span>
              <span><i />주민명부 제공 없음</span>
              <span><i />동·호 비공개</span>
            </div>

            <div className="v2-hero-stat v2-gate1-stat">
              <div><b>{serviceCount}</b><span>현재 공개된 이웃의 일</span></div>
              <div className="v2-gate1-hero-links">
                <button className="v2-gate1-about-link" type="button" onClick={() => setProjectStoryOpen(true)}>단지온 소개·운영안내</button>
                {onRegister && <button className="v2-gate1-about-link" type="button" onClick={onRegister}>내 일 알리기</button>}
              </div>
            </div>
          </div>

          <div className="v2-hero-photo v2-gate1-stage" aria-label="우리 단지 이웃의 작업 장면">
            <div className="v2-gate1-main-photo">
              <V2VisualImage data-v2-hero-image className="v2-hero-photo-bg" src={heroImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={heroImage.alt} fallbackLabel="이웃의 일" />
              <div className="v2-gate1-photo-caption"><small>우리 이웃의 일 01</small><b>손으로 만드는 하루</b></div>
            </div>
            <div className="v2-gate1-side-photo v2-gate1-side-top">
              <V2VisualImage src={sideTopImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={sideTopImage.alt} fallbackLabel="이웃의 기록" />
              <span>이웃의 기록</span>
            </div>
            <div className="v2-gate1-side-photo v2-gate1-side-bottom">
              <V2VisualImage src={sideBottomImage.src} fallbackSrc={LOCAL_HERO_FALLBACK} alt={sideBottomImage.alt} fallbackLabel="우리집 식탁" />
              <span>우리집 식탁</span>
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

      <V2Gate1Onboarding open={onboardingOpen} complexName={complexName} onClose={() => setOnboardingOpen(false)} onFinish={finishOnboarding} />
      <V2Gate1ProjectStory open={projectStoryOpen} onClose={() => setProjectStoryOpen(false)} />
    </>
  );
}
