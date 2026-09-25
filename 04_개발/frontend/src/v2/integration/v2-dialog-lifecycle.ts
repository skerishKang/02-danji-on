import { useEffect } from 'react';

export const V2_DIALOG_SELECTOR = '[aria-modal="true"]';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

type DialogEntry = {
  element: HTMLElement;
  previousFocus: HTMLElement | null;
};

type ManagedBackground = {
  inert: boolean;
  ariaHidden: string | null;
};

const dialogStack: DialogEntry[] = [];
const managedBackground = new Map<HTMLElement, ManagedBackground>();
let lastFocusedElement: HTMLElement | null = null;
let lastPointerElement: HTMLElement | null = null;

function isHTMLElement(value: Element | null): value is HTMLElement {
  return value instanceof HTMLElement;
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isVisible);
}

function closeButton(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>([
    '[data-v2-dialog-close]',
    '.v2-dialog-close',
    '.v2-onboarding-close',
    '.v2-community-close',
    '.v2-complex-hub-close',
    '.v2-resident-news-close',
    'button[aria-label*="닫기"]'
  ].join(','));
}

function dialogPath(dialog: HTMLElement): Set<HTMLElement> {
  const path = new Set<HTMLElement>();
  let current: HTMLElement | null = dialog;
  while (current && current !== document.body) {
    path.add(current);
    current = current.parentElement;
  }
  return path;
}

function shouldBeInert(dialog: HTMLElement | undefined): Set<HTMLElement> {
  const inert = new Set<HTMLElement>();
  if (!dialog || !dialog.isConnected) return inert;

  const path = dialogPath(dialog);
  let current: HTMLElement | null = dialog;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== current && isHTMLElement(sibling) && !path.has(sibling)) inert.add(sibling);
    }
    current = parent;
  }
  return inert;
}

function setManagedInert(elements: Set<HTMLElement>): void {
  for (const element of [...managedBackground.keys()]) {
    if (elements.has(element)) continue;
    const original = managedBackground.get(element);
    if (original) {
      element.inert = original.inert;
      if (original.ariaHidden === null) element.removeAttribute('aria-hidden');
      else element.setAttribute('aria-hidden', original.ariaHidden);
    }
    element.removeAttribute('data-v2-dialog-focus-inert');
    managedBackground.delete(element);
  }

  for (const element of elements) {
    if (!managedBackground.has(element)) {
      managedBackground.set(element, {
        inert: element.inert,
        ariaHidden: element.getAttribute('aria-hidden')
      });
    }
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    element.setAttribute('data-v2-dialog-focus-inert', '');
  }
}

function rememberFocus(event: FocusEvent): void {
  if (!(event.target instanceof HTMLElement) || event.target === document.body) return;
  if (event.target.closest('[data-v2-dialog-lifecycle="managed"]')) return;
  if (topDialog()?.contains(event.target)) return;
  lastFocusedElement = event.target;
}

function rememberPointerDown(event: PointerEvent): void {
  if (event.target instanceof HTMLElement) lastPointerElement = event.target;
}

function rememberClick(event: MouseEvent): void {
  if (event.target instanceof HTMLElement) lastPointerElement = event.target;
}

function focusInitialDialog(dialog: HTMLElement): void {
  if (!dialog.isConnected) return;
  const target = closeButton(dialog) ?? focusableElements(dialog)[0] ?? dialog;
  if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function restoreFocus(entries: DialogEntry[]): void {
  for (const entry of entries) {
    const target = entry.previousFocus;
    if (!target?.isConnected) continue;
    window.setTimeout(() => {
      if (target.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    }, 0);
    return;
  }
}

function topDialog(): HTMLElement | undefined {
  for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
    const dialog = dialogStack[index].element;
    if (dialog.isConnected) return dialog;
  }
  return undefined;
}

function syncDialogStack(): void {
  const dialogs = [...document.querySelectorAll<HTMLElement>(V2_DIALOG_SELECTOR)].filter((dialog) => dialog.isConnected);
  const connected = new Set(dialogs);
  const removed = dialogStack.filter((entry) => !connected.has(entry.element));
  const retained = dialogStack.filter((entry) => connected.has(entry.element));
  const known = new Set(retained.map((entry) => entry.element));
  const added = dialogs
    .filter((dialog) => !known.has(dialog))
    .map((dialog) => ({
      element: dialog,
      previousFocus: lastPointerElement ?? lastFocusedElement ?? (isHTMLElement(document.activeElement) ? document.activeElement : null)
    }));

  dialogStack.splice(0, dialogStack.length, ...retained, ...added);
  for (const entry of dialogStack) entry.element.setAttribute('data-v2-dialog-lifecycle', 'managed');
  setManagedInert(shouldBeInert(topDialog()));

  if (added.length) {
    queueMicrotask(() => {
      const dialog = topDialog();
      if (dialog) focusInitialDialog(dialog);
    });
  }
  if (removed.length) queueMicrotask(() => restoreFocus(removed));
}

function containsKeyboardEvent(event: KeyboardEvent, dialog: HTMLElement): boolean {
  const target = event.target;
  return target instanceof Node && dialog.contains(target);
}

function handleKeyDown(event: KeyboardEvent): void {
  const dialog = topDialog();
  if (!dialog) return;

  if (event.key === 'Escape') {
    const close = closeButton(dialog);
    if (!close) return;
    event.preventDefault();
    event.stopPropagation();
    close.click();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = focusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const activeInside = isHTMLElement(active) && containsKeyboardEvent(event, dialog);
  const activeIndex = activeInside ? focusable.indexOf(active as HTMLElement) : -1;
  if (event.shiftKey && (activeIndex <= 0 || !activeInside)) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (activeIndex === focusable.length - 1 || !activeInside)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function resetDialogStack(): void {
  setManagedInert(new Set());
  for (const entry of dialogStack) entry.element.removeAttribute('data-v2-dialog-lifecycle');
  dialogStack.splice(0, dialogStack.length);
}

export function useV2DialogLifecycle(): void {
  useEffect(() => {
    const observer = new MutationObserver(syncDialogStack);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerdown', rememberPointerDown, true);
    document.addEventListener('click', rememberClick, true);
    document.addEventListener('focusin', rememberFocus, true);
    document.addEventListener('keydown', handleKeyDown, true);
    syncDialogStack();

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', rememberPointerDown, true);
      document.removeEventListener('click', rememberClick, true);
      document.removeEventListener('focusin', rememberFocus, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      resetDialogStack();
      lastFocusedElement = null;
      lastPointerElement = null;
    };
  }, []);
}
