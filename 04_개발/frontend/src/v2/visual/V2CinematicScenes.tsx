import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { V2Icon } from './V2Icon';
import { V2VisualImage } from './V2VisualImage';
import { V2_SCENES, type V2Scene, type V2SceneKey } from './visual-data';

type SceneStyle = CSSProperties & {
  '--v2-scene-color': string;
  '--v2-scene-ink': string;
  '--v2-scene-dark': string;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

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
  const sectionRef = useRef<HTMLElement>(null);
  const manualUntilRef = useRef(0);
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

  useEffect(() => {
    if (reducedMotion || scenes.length < 2) return;
    const section = sectionRef.current;
    if (!section) return;

    let frame = 0;
    const updateFromScroll = () => {
      frame = 0;
      if (Date.now() < manualUntilRef.current) return;
      const rect = section.getBoundingClientRect();
      const distance = Math.max(1, rect.height - window.innerHeight);
      const progress = clamp(-rect.top / distance);
      const nextIndex = Math.min(scenes.length - 1, Math.floor(progress * scenes.length));
      const next = scenes[nextIndex];
      if (next && next.key !== activeKey) selectScene(next, false);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateFromScroll);
    };
    updateFromScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [activeKey, reducedMotion, scenes]);

  if (!activeScene) return null;

  function selectScene(next: V2Scene, manual = true) {
    if (next.key === activeScene.key) return;
    setPreviousScene(activeScene);
    setSwitching(!reducedMotion);
    setActiveKey(next.key);
    onSceneChange?.(next);
    if (manual) manualUntilRef.current = Date.now() + 1800;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPreviousScene(null);
      setSwitching(false);
      timerRef.current = null;
    }, reducedMotion ? 0 : 760);
  }

  const style: SceneStyle = {
    '--v2-scene-color': activeScene.color,
    '--v2-scene-ink': activeScene.ink,
    '--v2-scene-dark': activeScene.dark
  };
  const isSaved = savedShopIds.includes(activeScene.shopId);
  const railHeight = `${((activeIndex + 1) / Math.max(1, scenes.length)) * 100}%`;

  return (
    <section ref={sectionRef} className="v2-scene-world" aria-labelledby="v2-scene-caption" data-reduced-motion={reducedMotion || undefined} style={style}>
      <div className="v2-scene-sticky">
        <div className={`v2-scene-visual ${switching ? 'is-switching' : ''}`}>
          {previousScene && <V2VisualImage className="v2-scene-ghost" src={previousScene.image.src} alt="" aria-hidden="true" fallbackLabel="" />}
          <V2VisualImage className="v2-scene-image" src={activeScene.image.src} alt={activeScene.image.alt} fallbackLabel={activeScene.name} />
          <div className="v2-scene-depth-veil" />
          <div className="v2-scene-number"><span>{String(activeIndex + 1).padStart(2, '0')}</span> / {String(scenes.length).padStart(2, '0')} · 살아 있는 이웃의 일</div>
          <div className="v2-scene-caption">
            <h2 id="v2-scene-caption">{activeScene.caption}</h2>
            <p>{activeScene.captionText}</p>
          </div>
        </div>
        <aside className="v2-scene-panel" aria-label={`${activeScene.name} 정보`}>
          <div className="v2-scene-panel-top">
            <div className="v2-eyebrow">SCENE 02 · 필요한 일이 바뀌면 장면도 바뀝니다</div>
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
        <div className="v2-scene-tabs" role="tablist" aria-label="이웃 작업 장면 선택">
          {scenes.map((scene, index) => (
            <button
              key={scene.key}
              type="button"
              className="v2-scene-tab"
              role="tab"
              aria-selected={scene.key === activeScene.key}
              aria-label={`${String(index + 1).padStart(2, '0')} ${scene.caption}`}
              onClick={() => selectScene(scene, true)}
            >
              {String(index + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
        <div className="v2-scene-rail" aria-hidden="true"><span className="v2-scene-rail-fill" style={{ height: railHeight }} /></div>
        <div className="v2-scene-rail-label" aria-hidden="true">SCROLL / SELECT TO MOVE THROUGH NEIGHBORS</div>
      </div>
    </section>
  );
}
