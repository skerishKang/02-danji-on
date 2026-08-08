function buttonByText(root: ParentNode, text: string) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === text) ?? null;
}

function waitFor<T extends Element>(selector: string, timeoutMs = 5000): Promise<T | null> {
  const existing = document.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const match = document.querySelector<T>(selector);
      if (!match) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(match);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function highlightBusiness(name: string) {
  const container = await waitFor<HTMLElement>('.service-grid');
  if (!container) return;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const card = Array.from(document.querySelectorAll<HTMLElement>('.service-card')).find((item) => item.textContent?.includes(name));
    if (card) {
      card.classList.add('deep-link-highlight');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
}

export async function installResidentDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') !== 'listings') return;

  const nav = await waitFor<HTMLElement>('.desktop-nav');
  if (!nav) return;
  const listingsButton = buttonByText(nav, '가게·서비스');
  if (!listingsButton) return;
  listingsButton.click();

  const businessName = params.get('businessName')?.trim();
  if (businessName) await highlightBusiness(businessName);
}
