import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import V2SettingsPanel from './V2SettingsPanel';

export default function V2SettingsPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.v2-profile-dialog');
      setTarget((current) => current === next ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target ? createPortal(<V2SettingsPanel />, target) : null;
}
