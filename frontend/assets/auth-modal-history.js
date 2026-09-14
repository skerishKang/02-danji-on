// Issue #444 [post-auth UX]: bounded auth-modal step history coordinated with a
// single window.history sentinel entry.
//
// The modal pushes exactly ONE same-document history state while it is open
// (the "trap"); internal step transitions move through the bounded modalHistory
// stack only. Browser Back therefore unwinds modal steps first and closes the
// modal at the first step, instead of leaving the page. When the modal is
// closed (X, backdrop, finish, or Back at the first step) the sentinel is
// removed with a single history.back() coordinated by the active flag, so the
// next browser Back behaves normally and never rides a stale modal state.
//
// This module is DOM-free on purpose: the same instance drives both the
// on-screen modal Back button and the browser popstate path (one transition
// function, no duplicated logic), and it is exercised directly by
// frontend/tests/leaf-b14-post-auth-landing-history-ux-contract.mjs.
(function (global) {
  'use strict';

  function createAuthModalHistory(binding) {
    const historyApi = binding.history;
    const pageLocation = binding.location;
    const onStep = binding.onStep;
    const onClose = binding.onClose || function () {};
    let open = false;
    let current = null;
    let steps = [];
    let sentinelActive = false;

    function pushSentinel() {
      sentinelActive = true;
      historyApi.pushState({ danjionAuthModal: true, step: current }, '', pageLocation.href);
    }

    function unwindOne() {
      if (steps.length) {
        current = steps.pop();
        onStep(current);
        pushSentinel();
        return;
      }
      close();
    }

    function close() {
      open = false;
      current = null;
      steps = [];
      onClose();
      if (sentinelActive) {
        sentinelActive = false;
        historyApi.back();
      }
    }

    return Object.freeze({
      open(step) {
        open = true;
        current = step;
        steps = [];
        onStep(step);
        if (!sentinelActive) pushSentinel();
      },
      step(name) {
        if (!open || !name || name === current) return;
        steps.push(current);
        current = name;
        onStep(name);
      },
      back() {
        if (!open) return;
        if (steps.length) {
          current = steps.pop();
          onStep(current);
          return;
        }
        close();
      },
      popState(state) {
        if (state && state.danjionAuthModal) {
          sentinelActive = true;
          return;
        }
        sentinelActive = false;
        if (open) unwindOne();
      },
      resetToEntry() {
        steps = [];
        current = 'entry';
        onStep('entry');
      },
      close,
      isOpen: () => open,
      hasSentinel: () => sentinelActive,
      depth: () => steps.length,
      current: () => current
    });
  }

  global.DanjionAuthModalHistory = Object.freeze({ create: createAuthModalHistory });
})(typeof window !== 'undefined' ? window : globalThis);
