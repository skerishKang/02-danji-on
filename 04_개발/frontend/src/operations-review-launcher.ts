import { adminAdapter } from './admin-api';

const LINK_CLASS = 'operations-review-link';
let installing = false;

async function decorateCards() {
  if (installing) return;
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.admin-application-card'));
  if (!cards.length) return;
  installing = true;
  try {
    const applications = await adminAdapter.listApplications('all');
    const remaining = [...applications];
    cards.forEach((card) => {
      if (card.querySelector(`.${LINK_CLASS}`)) return;
      const name = card.querySelector('h3')?.textContent?.trim();
      if (!name) return;
      const index = remaining.findIndex((item) => item.businessName === name);
      if (index < 0) return;
      const application = remaining.splice(index, 1)[0];
      if (!['pending', 'changes_requested', 'approved'].includes(application.status)) return;
      const actions = card.querySelector('.review-actions');
      if (!actions) return;
      const link = document.createElement('a');
      link.className = LINK_CLASS;
      link.href = `/operations-review.html?application=${encodeURIComponent(application.id)}`;
      link.textContent = application.status === 'approved' ? '공개 결과 확인' : '운영확인';
      link.setAttribute('aria-label', `${application.businessName} ${link.textContent}`);
      actions.prepend(link);
    });
  } finally {
    installing = false;
  }
}

export function installOperationsReviewLauncher() {
  void decorateCards();
  const observer = new MutationObserver(() => void decorateCards());
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
