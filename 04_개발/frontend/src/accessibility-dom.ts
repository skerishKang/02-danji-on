const namedSelectors: Array<[string, string]> = [
  ['.filter-panel input', '가게·서비스 검색'],
  ['.filter-panel select', '가게·서비스 관계 필터']
];

function applyAccessibleNames(root: ParentNode = document) {
  for (const [selector, label] of namedSelectors) {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) {
        element.setAttribute('aria-label', label);
      }
    });
  }
}

export function installResidentAccessibilityEnhancements() {
  applyAccessibleNames();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          if (node.matches('.filter-panel, .filter-panel *')) applyAccessibleNames(node.closest('.filter-panel') ?? node);
          else applyAccessibleNames(node);
        }
      });
    }
  });
  observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
