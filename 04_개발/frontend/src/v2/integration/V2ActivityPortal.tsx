import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import V2ActivityPanel from './V2ActivityPanel';

function findProfileDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.v2-profile-dialog');
}

export default function V2ActivityPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const sync = () => {
      const next = findProfileDialog();
      if (next !== current) {
        current = next;
        setTarget(next);
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return target ? createPortal(<V2ActivityPanel />, target) : null;
}
