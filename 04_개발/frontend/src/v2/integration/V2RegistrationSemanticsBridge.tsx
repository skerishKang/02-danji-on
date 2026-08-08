import { useEffect } from 'react';
import './v2-semantics.css';

const DIALOG_SELECTOR = '.v2-registration-dialog';
const LEGEND_SELECTOR = `${DIALOG_SELECTOR} legend`;
const HEADING_MARKER = 'data-v2-registration-heading';
const SOURCE_MARKER = 'data-v2-registration-legend-source';

function synchronizeRegistrationHeading() {
  const dialog = document.querySelector<HTMLElement>(DIALOG_SELECTOR);
  if (!dialog) return;

  const legend = dialog.querySelector<HTMLElement>(LEGEND_SELECTOR.replace(`${DIALOG_SELECTOR} `, ''));
  if (!legend) return;

  const label = legend.textContent?.trim() ?? '';
  if (!label) return;

  let heading = dialog.querySelector<HTMLHeadingElement>(`h2[${HEADING_MARKER}]`);
  if (!heading) {
    heading = document.createElement('h2');
    heading.setAttribute(HEADING_MARKER, 'true');
    heading.className = 'v2-registration-heading';
    legend.insertAdjacentElement('afterend', heading);
  }

  if (heading.textContent !== label) heading.textContent = label;

  const existingId = legend.id || heading.id || 'v2-registration-dialog-title';
  if (legend.id) legend.removeAttribute('id');
  if (!legend.hasAttribute(SOURCE_MARKER)) legend.setAttribute(SOURCE_MARKER, 'true');
  if (heading.id !== existingId) heading.id = existingId;
}

export function V2RegistrationSemanticsBridge() {
  useEffect(() => {
    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        synchronizeRegistrationHeading();
      });
    };

    scheduleSync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
