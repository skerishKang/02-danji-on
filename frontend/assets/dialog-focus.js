// Issue #980: shared canonical dialog focus lifecycle.
(function (global) {
  'use strict';

  const stack = [];
  const managedInert = new Map();
  const selector = '[role="dialog"],dialog[open],.modal-layer:not([hidden]),.shop-compare-modal.open,.shop-inquiry-modal.open,.b-coupon-modal.open,.review-modal.open,.review-write-modal.open,.sheet-backdrop.open';
  let lastTrigger = null;
  let started = false;

  const dialogOf = el => el && (el.matches?.('dialog') ? el : el.querySelector?.('dialog,[role="dialog"]'));
  const isOpen = el => !!el && (
    el.open === true ||
    el.classList.contains('open') ||
    (!el.hasAttribute('hidden') && el.matches('.modal-layer'))
  );
  const top = () => stack[stack.length - 1];

  function focusable(root) {
    return [...root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )].filter(el => el.getClientRects().length && !el.closest('[inert]') && !el.hidden);
  }

  function rememberTrigger(event) {
    if (!(event.target instanceof Element)) return;
    const candidate = event.target.closest(
      'button,a[href],input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])'
    );
    if (candidate instanceof HTMLElement) lastTrigger = candidate;
  }

  function triggerFor(dialog) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (active && active !== document.body && !dialog.contains(active)) return active;
    if (lastTrigger && lastTrigger.isConnected && !dialog.contains(lastTrigger)) return lastTrigger;
    return null;
  }

  function manageInert(el) {
    if (!(el instanceof HTMLElement)) return;
    if (!managedInert.has(el)) managedInert.set(el, el.inert === true);
    el.inert = true;
    el.dataset.danjionFocusInert = '1';
  }

  function restoreManagedInert() {
    for (const [el, previous] of managedInert) {
      if (el.isConnected) {
        el.inert = previous;
        delete el.dataset.danjionFocusInert;
      }
    }
    managedInert.clear();
  }

  // Only the topmost layer is interactive. If a dialog is nested in the DOM,
  // inert its siblings at every ancestor level instead of inerting its ancestor.
  function suppress() {
    restoreManagedInert();
    const active = top();
    if (!active) return;

    let node = active.layer;
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling !== node) manageInert(sibling);
      }
      node = parent;
    }
  }

  function focusInitial(item) {
    const target = focusable(item.dialog)[0] || item.dialog;
    requestAnimationFrame(() => {
      if (top() !== item || !isOpen(item.layer)) return;
      if (target === item.dialog && !item.dialog.hasAttribute('tabindex')) {
        item.dialog.setAttribute('tabindex', '-1');
        item.addedTabIndex = true;
      }
      target.focus?.({ preventScroll: true });
    });
  }

  function restoreFocus(item) {
    requestAnimationFrame(() => {
      if (item.addedTabIndex && item.dialog.isConnected) item.dialog.removeAttribute('tabindex');
      if (!item.trigger || !item.trigger.isConnected) return;
      const parent = top();
      if (parent) {
        if (parent.dialog.contains(item.trigger)) item.trigger.focus?.({ preventScroll: true });
        return;
      }
      item.trigger.focus?.({ preventScroll: true });
    });
  }

  function containTab(event) {
    if (event.key !== 'Tab') return;
    const item = top();
    if (!item || !isOpen(item.layer)) return;

    const list = focusable(item.dialog);
    if (!list.length) {
      event.preventDefault();
      item.dialog.focus?.({ preventScroll: true });
      return;
    }

    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !item.dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !item.dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function sync() {
    const candidates = [...document.querySelectorAll(selector)]
      .filter(isOpen)
      .map(layer => ({ layer, dialog: dialogOf(layer) || layer }));

    for (let i = stack.length - 1; i >= 0; i--) {
      if (!candidates.some(candidate => candidate.layer === stack[i].layer)) {
        const closed = stack[i];
        stack.splice(i, 1);
        restoreFocus(closed);
      }
    }

    for (const candidate of candidates) {
      if (stack.some(item => item.layer === candidate.layer)) continue;
      const item = {
        layer: candidate.layer,
        dialog: candidate.dialog,
        trigger: triggerFor(candidate.dialog),
        addedTabIndex: false
      };
      stack.push(item);
      suppress();
      focusInitial(item);
    }

    if (stack.length) suppress();
    else restoreManagedInert();
  }

  const observer = new MutationObserver(sync);

  function start() {
    if (started || !document.body) return;
    started = true;
    document.addEventListener('click', rememberTrigger, true);
    document.addEventListener('keydown', containTab, true);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'aria-hidden']
    });
    sync();
  }

  global.DanjionDialogFocus = Object.freeze({
    start,
    sync,
    top: () => top()?.dialog || null,
    stack: () => stack.map(item => item.dialog)
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
