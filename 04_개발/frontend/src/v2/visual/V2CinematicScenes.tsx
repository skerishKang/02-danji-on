import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { V2DailyHomeSummary } from './V2Hero';
import { V2Icon } from './V2Icon';
import { V2VisualImage } from './V2VisualImage';
import { V2_SCENES, type V2Scene, type V2SceneKey } from './visual-data';

type SceneStyle = CSSProperties & {
  '--v2-scene-color': string;
  '--v2-scene-ink': string;
  '--v2-scene-dark': string;
};

const LOCAL_SCENE_FALLBACK = '/field-demo/scenes-sprite.jpg';

export function V2CinematicScenes({
  scenes = V2_SCENES,
  reducedMotion = false,
  onSceneChange,
  onOpenDetail,
  onToggleSave,
  savedShopIds = []
}: {
  scenes?: V2Scene[];
  reducedMotion?: boolean;
  onSceneChange?: (scene: V2Scene) => void;
  onOpenDetail?: (shopId: string) => void;
  onToggleSave?: (shopId: string) => void;
  savedShopIds?: string[];
}) {
  const timerRef = useRef<number | null>(null);
  const [activeKey, setActiveKey] = useState<V2SceneKey>(scenes[0]?.key ?? 'food');
  const [previousScene, setPreviousScene] = useState<V2Scene | null>(null);
  const [switching, setSwitching] = useState(false);

  const activeScene = useMemo(() => scenes.find((scene) => scene.key === activeKey) ?? scenes[0], [activeKey, scenes]);
  const activeIndex = activeScene ? Math.max(0, scenes.findIndex((scene) => scene.key === activeScene.key)) : 0;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!activeScene) return null;

  function selectScene(next: V2Scene) {
    if (next.key === activeScene.key) return;
    setPreviousScene(activeScene);
    setSwitching(!reducedMotion);
    setActiveKey(next.key);
    onSceneChange?.(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPreviousScene(null);
      setSwitching(false);
      timerRef.current = null;
    }, reducedMotion ? 0 : 760);
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % scenes.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + scenes.length) % scenes.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = scenes.length - 1;
    const next = scenes[nextIndex];
    if (!next) return;
    selectScene(next);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[data-v2-scene-tab]');
    window.requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
  }

  const style: SceneStyle = {
    '--v2-scene-color': activeScene.color,
    '--v2-scene-ink': activeScene.ink,
    '--v2-scene-dark': activeScene.dark
  };
  const isSaved = savedShopIds.includes(activeScene.shopId);
  const railHeight = `${((activeIndex + 1) / Math.max(1, scenes.length)) * 100}%`;
  const sceneNumber = String(activeIndex + 1).padStart(2, '0');

  return (
    <>
      <section data-v2-section="cinematic" className="v2-scene-world" aria-label="시네마틱 이웃가게 소개" data-reduced-motion={reducedMotion || undefined} style={style}>
        <div data-v2-cinematic-stage className="v2-scene-sticky">
          <div className={`v2-scene-visual ${switching ? 'is-switching' : ''}`}>
            {previousScene && <V2VisualImage className="v2-scene-ghost" src={previousScene.image.src} fallbackSrc={LOCAL_SCENE_FALLBACK} alt="" aria-hidden="true" fallbackLabel="" />}
            <V2VisualImage className="v2-scene-image" src={activeScene.image.src} fallbackSrc={LOCAL_SCENE_FALLBACK} alt={activeScene.image.alt} fallbackLabel={activeScene.name} />
            <div className="v2-scene-depth-veil" />
            <div className="v2-scene-number"><span>{sceneNumber}</span> / {String(scenes.length).padStart(2, '0')} · LIVING NEIGHBOR WORK</div>
            <div className="v2-scene-caption">
              <div className="v2-scene-kicker">단지온이 소개하는 이웃의 일</div>
              <h2>{activeScene.caption}</h2>
              <p>{activeScene.captionText}</p>
            </div>
          </div>
          <aside data-v2-cinematic-panel className="v2-scene-panel" aria-label={`${activeScene.name} 정보`}>
            <div className="v2-scene-panel-top">
              <div className="v2-eyebrow">SCENE {sceneNumber} · RESIDENT WORK</div>
              <h3 className="v2-scene-service">{activeScene.name}</h3>
              <p className="v2-scene-copy">{activeScene.copy}</p>
              <div className="v2-scene-facts">
                <div className="v2-scene-fact"><b>주민 관계</b><span>{activeScene.relation}</span></div>
                <div className="v2-scene-fact"><b>이용 방법</b><span>{activeScene.price}</span></div>
                <div className="v2-scene-fact"><b>주민 혜택</b><span>{activeScene.benefit}</span></div>
                <div className="v2-scene-fact"><b>상태</b><span>{activeScene.status}</span></div>
              </div>
            </div>
            <div className="v2-scene-actions">
              <button className="v2-btn v2-btn-primary v2-btn-small" type="button" onClick={() => onOpenDetail?.(activeScene.shopId)}>이 이웃의 일 보기</button>
              <button className="v2-btn v2-btn-small" type="button" aria-pressed={isSaved} onClick={() => onToggleSave?.(activeScene.shopId)}><V2Icon name="heart" /> {isSaved ? '저장됨' : '저장'}</button>
            </div>
          </aside>
          <div className="v2-scene-tabs" role="group" aria-label="이웃가게 장면 선택">
            {scenes.map((scene, index) => (
              <button
                data-v2-scene-tab
                key={scene.key}
                type="button"
                className="v2-scene-tab"
                aria-pressed={scene.key === activeScene.key}
                aria-label={`${String(index + 1).padStart(2, '0')} ${scene.caption}`}
                onClick={() => selectScene(scene)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                {String(index + 1).padStart(2, '0')}
              </button>
            ))}
          </div>
          <div className="v2-scene-rail" aria-hidden="true"><span className="v2-scene-rail-fill" style={{ height: railHeight }} /></div>
          <div className="v2-scene-rail-label" aria-hidden="true">SELECT SCENE / SCROLL CONTINUES PAGE</div>
        </div>
      </section>
      <V2DailyHomeSummary />
    </>
  );
}
