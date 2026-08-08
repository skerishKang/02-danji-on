import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { V2CinematicScenes } from './V2CinematicScenes';
import { V2Hero } from './V2Hero';
import { V2Topbar, type V2VisualNavKey } from './V2Topbar';
import { V2_SCENES } from './visual-data';

export function V2VisualFrame({
  children,
  reducedMotion,
  activeNav = 'home',
  serviceCount = 7,
  onNavigate,
  onSearch,
  onBrowse,
  onRegister,
  onOpenDetail,
  onToggleSave,
  savedShopIds
}: {
  children?: ReactNode;
  reducedMotion?: boolean;
  activeNav?: V2VisualNavKey;
  serviceCount?: number;
  onNavigate?: (key: V2VisualNavKey) => void;
  onSearch?: (query: string) => void;
  onBrowse?: () => void;
  onRegister?: () => void;
  onOpenDetail?: (shopId: string) => void;
  onToggleSave?: (shopId: string) => void;
  savedShopIds?: string[];
}) {
  const [accent, setAccent] = useState(V2_SCENES[0].color);
  const [progress, setProgress] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reducedMotion || prefersReducedMotion) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [prefersReducedMotion, reducedMotion]);

  const motionReduced = reducedMotion ?? prefersReducedMotion;

  return (
    <div className="v2-visual-surface" data-reduced-motion={motionReduced || undefined} style={{ '--v2-accent': accent } as CSSProperties}>
      <a className="v2-skip" href="#v2-main">본문으로 건너뛰기</a>
      <V2Topbar active={activeNav} progress={progress} onNavigate={onNavigate} onOpenSearch={() => document.getElementById('v2-hero-search')?.focus()} onOpenProfile={() => onNavigate?.('me')} />
      <main id="v2-main" className="v2-main">
        <V2Hero serviceCount={serviceCount} onSearch={onSearch} onBrowse={onBrowse} onRegister={onRegister} />
        <V2CinematicScenes
          reducedMotion={motionReduced}
          savedShopIds={savedShopIds}
          onSceneChange={(scene) => setAccent(scene.color)}
          onOpenDetail={onOpenDetail}
          onToggleSave={onToggleSave}
        />
        {children}
      </main>
    </div>
  );
}
