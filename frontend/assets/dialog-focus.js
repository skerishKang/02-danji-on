// Issue #980: shared canonical dialog focus lifecycle.
(function (global) {
  'use strict';
  const stack = [];
  const selector = '[role="dialog"],dialog[open],.modal-layer:not([hidden]),.shop-compare-modal.open,.shop-inquiry-modal.open,.b-coupon-modal.open,.review-modal.open,.review-write-modal.open,.sheet-backdrop.open';
  const dialogOf = el => el && (el.matches?.('dialog') ? el : el.querySelector?.('dialog,[role="dialog"]'));
  const focusable = root => [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length && !el.closest('[inert]') && !el.hidden);
  const isOpen = el => !!el && (el.open === true || el.classList.contains('open') || (!el.hasAttribute('hidden') && el.matches('.modal-layer')));
  const top = () => stack[stack.length - 1];
  function rememberInert(el) { return { el, value: el.inert === true, aria: el.getAttribute('aria-hidden') }; }
  function suppress() {
    const active = top(); if (!active) return;
    const layers = stack.map(x => x.layer);
    [...document.body.children].forEach(el => { if (!layers.includes(el)) { el.inert = true; el.dataset.danjionFocusInert = '1'; } });
    const parent = active.layer.parentElement;
    if (parent && parent.matches?.('body')) return;
    const parentDialog = active.layer.parentElement && active.layer.parentElement.closest?.('[role="dialog"],dialog');
    if (parentDialog) [...parentDialog.children].forEach(el => { if (el !== active.layer) { el.inert = true; el.dataset.danjionFocusInert = '1'; } });
  }
  function unsuppress() {
    [...document.querySelectorAll('[data-danjion-focus-inert]')].forEach(el => { el.inert = false; delete el.dataset.danjionFocusInert; });
  }
  function focusInitial(item) {
    const target = item.initialFocus || focusable(item.dialog)[0] || item.dialog;
    requestAnimationFrame(() => { if (top() === item && isOpen(item.layer)) target.focus?.({ preventScroll: true }); });
  }
  function closeTopIf(event) {
    const item = top(); if (!item || !isOpen(item.layer)) return;
    if (event.key === 'Tab') {
      const list = focusable(item.dialog); if (!list.length) { event.preventDefault(); item.dialog.focus?.(); return; }
      const first = list[0], last = list[list.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || !item.dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !item.dialog.contains(active))) { event.preventDefault(); first.focus(); }
    }
  }
  function sync() {
    const candidates = [...document.querySelectorAll(selector)].filter(isOpen).map(layer => ({ layer, dialog: dialogOf(layer) || layer }));
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!candidates.some(x => x.layer === stack[i].layer)) {
        const closed = stack[i];
        stack.splice(i, 1);
        restore(closed);
      }
    }
    for (const next of candidates) if (!stack.some(x => x.layer === next.layer)) {
      const item = { layer: next.layer, dialog: next.dialog, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      stack.push(item); suppress(); focusInitial(item);
    }
    if (!stack.length) unsuppress();
    else suppress();
  }
  function restore(item) {
    requestAnimationFrame(() => {
      if (!item.trigger || !item.trigger.isConnected) return;
      const parent = top();
      if (parent) {
        if (parent.dialog.contains(item.trigger)) item.trigger.focus?.({ preventScroll: true });
        return;
      }
      item.trigger.focus?.({ preventScroll: true });
    });
  }
  const observer = new MutationObserver(sync);
  function start() {
    if (!document.body) return;
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'aria-hidden'] });
    document.addEventListener('keydown', closeTopIf, true);
    sync();
  }
  global.DanjionDialogFocus = Object.freeze({ start, sync, top: () => top()?.dialog || null, stack: () => stack.map(x => x.dialog) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})(window);
