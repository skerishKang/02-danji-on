import { useState } from 'react';
import { V2Gate1ProjectStory } from './V2Gate1Onboarding';
import { V2VisualImage } from './V2VisualImage';
import { V2_REFERENCE_IMAGES } from './visual-data';

const LOCAL_IMAGE_FALLBACK = '/field-demo/scenes-sprite.jpg';

export function V2Gate1ResidentHome({
  complexName = '방림명지로드힐',
  onBrowse,
  onOpenBenefits,
  onRegister,
  onOpenCommunity
}: {
  complexName?: string;
  onBrowse?: () => void;
  onOpenBenefits?: () => void;
  onRegister?: () => void;
  onOpenCommunity?: () => void;
}) {
  const [projectStoryOpen, setProjectStoryOpen] = useState(false);

  return (
    <>
      <section id="v2-resident-home" data-v2-section="resident-home" className="v2-gate1-resident-home" aria-labelledby="v2-resident-home-title">
        <div className="v2-gate1-home-head">
          <div>
            <span className="v2-gate1-home-kicker">TODAY · {complexName}</span>
            <h2 id="v2-resident-home-title">오늘, 우리 단지에서 볼 것</h2>
          </div>
          <p>큰 장면 하나와 필요한 정보만 선별했습니다.<br />동·호는 홈과 공개 프로필에 표시하지 않습니다.</p>
        </div>

        <div className="v2-gate1-home-grid">
          <article className="v2-gate1-home-story">
            <V2VisualImage src={V2_REFERENCE_IMAGES.home.src} fallbackSrc={LOCAL_IMAGE_FALLBACK} alt={V2_REFERENCE_IMAGES.home.alt} fallbackLabel="오래 쓰는 것을 고치는 손" />
            <div className="v2-gate1-home-story-copy">
              <small>살아 있는 이웃의 일 · React Preview</small>
              <h3>오래 쓰는 것을<br />고치는 손</h3>
              <p>우리 단지 가까이에서 만나는 생활 수선 이야기</p>
              <button type="button" onClick={onBrowse}>이웃의 일 둘러보기 →</button>
            </div>
          </article>

          <article className="v2-gate1-home-benefit">
            <div><span>RESIDENT BENEFIT 01</span><strong>10%</strong></div>
            <div><h3>{complexName}<br />주민 혜택</h3><p>이웃의 일을 알고, 주민만의 작은 혜택을 나눕니다.</p><button type="button" onClick={onOpenBenefits}>혜택 보기 →</button></div>
          </article>

          <article className="v2-gate1-home-quick">
            <div className="v2-gate1-home-quick-title">바로가기</div>
            <button type="button" onClick={() => setProjectStoryOpen(true)}>회장 인사 <span>→</span></button>
            <button type="button" onClick={() => setProjectStoryOpen(true)}>단지온 도입과 운영 <span>→</span></button>
            <button type="button" onClick={onRegister}>내 일 알리기 <span>→</span></button>
            <button type="button" onClick={onOpenCommunity}>우리단지 <span>→</span></button>
          </article>
        </div>

        <div className="v2-gate1-home-archive">
          <div className="v2-gate1-home-archive-head"><h3>우리 단지의 변화</h3><button type="button" onClick={onOpenCommunity}>전체 기록 보기 →</button></div>
          <div className="v2-gate1-home-timeline">
            <article><div><span>2026.09 · 서비스 준비</span><b>진행중</b></div><h4>주민 생활편의 서비스<br />단지온 도입 준비</h4><p><span>제안 · 주민 대표</span><span>운영 · PADIEM</span></p></article>
            <article><div><span>2026.08 · 주민 안내</span><b>준비</b></div><h4>주민 안내와 이용 방법을<br />쉽게 설명하는 단계</h4><p><span>안내 · 단지온</span><span>협조 · 관리주체</span></p></article>
            <article><div><span>서비스 개시일부터</span><b>1년</b></div><h4>구축비·플랫폼 운영비<br />초기 무상지원 계획</h4><p><span>지원 · PADIEM</span><span>자동 유료전환 없음</span></p></article>
          </div>
        </div>
      </section>

      <V2Gate1ProjectStory open={projectStoryOpen} onClose={() => setProjectStoryOpen(false)} />
    </>
  );
}
