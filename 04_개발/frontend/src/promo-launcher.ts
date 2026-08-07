import { dataAdapter } from './api/adapter';
import type { BusinessApplication } from './types';

let scheduled = false;
let running = false;

function eligible(application: BusinessApplication) {
  return application.status === 'pending' || application.status === 'approved';
}

function bucketByName(applications: BusinessApplication[]) {
  const buckets = new Map<string, BusinessApplication[]>();
  applications.forEach((application) => {
    const current = buckets.get(application.businessName) ?? [];
    current.push(application);
    buckets.set(application.businessName, current);
  });
  return buckets;
}

async function enhanceApplicationList() {
  if (running) return;
  const items = Array.from(document.querySelectorAll<HTMLElement>('.application-item'));
  if (!items.length) return;
  running = true;
  try {
    const applications = await dataAdapter.listMyBusinessApplications();
    const buckets = bucketByName(applications);

    items.forEach((item) => {
      const name = item.querySelector('strong')?.textContent?.trim() ?? '';
      const application = buckets.get(name)?.shift();
      const existing = item.querySelector<HTMLAnchorElement>('.application-promo-link');
      if (!application || !eligible(application)) {
        existing?.remove();
        return;
      }

      const href = `/promo.html?application=${encodeURIComponent(application.id)}`;
      if (existing) {
        existing.href = href;
        existing.dataset.applicationId = application.id;
        return;
      }

      const link = document.createElement('a');
      link.className = 'application-promo-link';
      link.href = href;
      link.dataset.applicationId = application.id;
      link.textContent = '홍보물 만들기';
      link.setAttribute('aria-label', `${application.businessName} 홍보물 만들기`);
      item.append(link);
    });
  } catch {
    // The resident app already owns primary error handling. Promo enhancement stays non-blocking.
  } finally {
    running = false;
  }
}

function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void enhanceApplicationList();
  });
}

export function installPromoMaterialLaunchers() {
  scheduleEnhancement();
  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pageshow', scheduleEnhancement);
  return () => {
    observer.disconnect();
    window.removeEventListener('pageshow', scheduleEnhancement);
  };
}
