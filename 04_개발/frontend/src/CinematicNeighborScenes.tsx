import { useState } from 'react';
import './cinematic-neighbor-scenes.css';

const scenes = [
  {
    id: 'food',
    tab: '반찬·먹거리',
    eyebrow: '같은 단지에서 만드는 먹거리',
    title: '오늘 필요한 반찬을\n가까운 이웃에게서',
    description: '직접 만드는 음식과 생활 먹거리를 주민 관계부터 확인하고 발견합니다.',
    image: '/field-demo/scene-food.webp',
    alt: '주민이 직접 음식을 만들고 포장하는 작업 장면'
  },
  {
    id: 'learning',
    tab: '과외·수업',
    eyebrow: '우리 단지의 배움',
    title: '멀리 찾기 전에\n이웃의 전문성을 발견합니다',
    description: '수학 과외와 소규모 수업처럼 신뢰가 중요한 서비스는 주민 관계를 먼저 보여줍니다.',
    image: '/field-demo/scene-learning.webp',
    alt: '학습 자료를 두고 학생을 지도하는 수업 장면'
  },
  {
    id: 'home-care',
    tab: '생활수리',
    eyebrow: '집에서 바로 필요한 일',
    title: '수리와 청소도\n우리 동네에서 빠르게',
    description: '에어컨 청소, 방충망, 생활 소수리 같은 방문 서비스를 지역과 이용시간까지 함께 확인합니다.',
    image: '/field-demo/scene-home-care.webp',
    alt: '가정에서 생활 설비를 점검하고 수리하는 작업 장면'
  },
  {
    id: 'professional',
    tab: '상담·전문',
    eyebrow: '주민의 전문 서비스',
    title: '세무·노무·문서 상담도\n가까운 연결부터',
    description: '전문서비스는 과장된 보증 대신 실제 제공 내용과 주민 관계, 문의 경계를 명확히 보여줍니다.',
    image: '/field-demo/scene-professional.webp',
    alt: '책상에서 문서와 노트북을 두고 전문 상담을 준비하는 장면'
  }
] as const;

export default function CinematicNeighborScenes({
  onSearch,
  onRegister
}: {
  onSearch: () => void;
  onRegister: () => void;
}) {
  const [activeId, setActiveId] = useState<(typeof scenes)[number]['id']>('food');
  const activeIndex = scenes.findIndex((scene) => scene.id === activeId);
  const active = scenes[activeIndex];

  return (
    <section className="cinematic-neighbors" aria-labelledby="cinematic-neighbors-title">
      <div className="cinematic-copy">
        <span className="cinematic-kicker">LIVING NEIGHBOR ECONOMY</span>
        <h2 id="cinematic-neighbors-title">이웃이 실제로 하는 일을<br />장면으로 먼저 만나보세요</h2>
        <p>단지온은 가게 목록보다 먼저, 같은 생활권에서 누가 어떤 일을 하는지 보여줍니다.</p>
        <div className="cinematic-actions">
          <button className="primary" onClick={onSearch}>가게와 서비스 찾기</button>
          <button className="secondary" onClick={onRegister}>내 일 알리기</button>
        </div>
      </div>

      <div className="cinematic-stage" aria-live="polite">
        <div className="cinematic-image-wrap" key={active.id}>
          <img src={active.image} alt={active.alt} />
          <div className="cinematic-vignette" aria-hidden="true" />
          <div className="cinematic-scene-copy">
            <span>{active.eyebrow}</span>
            <h3>{active.title.split('\n').map((line) => <span key={line}>{line}</span>)}</h3>
            <p>{active.description}</p>
          </div>
          <span className="cinematic-counter" aria-hidden="true">0{activeIndex + 1} / 04</span>
        </div>

        <div className="cinematic-tabs" role="tablist" aria-label="이웃 작업 장면">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              role="tab"
              aria-selected={scene.id === activeId}
              className={scene.id === activeId ? 'active' : ''}
              onClick={() => setActiveId(scene.id)}
            >
              <span>{scene.tab}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
