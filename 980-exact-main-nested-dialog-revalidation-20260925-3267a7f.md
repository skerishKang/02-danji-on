# TASK #980 — exact-main nested dialog revalidation

- **Task:** `#980_EXACT_MAIN_NESTED_DIALOG_REVALIDATION`
- **Date:** 2026-09-25
- **Lane:** `DANJION3`
- **Classification:** **B — exact current main PASS**
- **Source changes:** none
- **Google Drive / production backend:** not used

## 1. Exact-main provenance

A fresh detached worktree was created from freshly fetched `origin/main`:

- Worktree: `E:/danjion-980-exact-main`
- Exact main SHA: `3267a7fed7057c38c2863bca9ebea097ca7bafea`
- Worktree state after verification/cleanup: clean (`## HEAD (no branch)`)

The pre-existing `fix/980` worktree was not used.

## 2. Served `dialog-focus.js` identity

The exact-main `frontend/` directory was served locally on `127.0.0.1:8765` for Tabbit. The served asset was fetched over HTTP with cache disabled and hashed in the browser.

- Main Git blob: `47a7987ed060557ccac0bf46f227a2fff387ecc4`
- Main SHA-256: `3705be6fd112fe864a790791182dd99e56bf6c2c65288e776c6e518755c6e0f1`
- Served HTTP status: `200`
- Served byte length: `5848`
- Served SHA-256: `3705be6fd112fe864a790791182dd99e56bf6c2c65288e776c6e518755c6e0f1`
- Result: **served bytes match the current-main blob exactly**

## 3. Tabbit: Neighbor Shops at 390x844

Flow exercised on the locally served exact-main frontend:

`이웃가게` → `로드힐 꽃작업실` → `가게 문의`

### Inquiry open state

- `#shopInquiryModal.class`: `shop-inquiry-modal open` — contains `open`
- `#shopInquiryModal.inert`: `false`
- `#shopCompareModal.inert`: `true`
- Focus: `#shopInquiryClose` — inside the inquiry dialog
- `DanjionDialogFocus.stack().length`: `2`

### Escape from the same nested state

- Inquiry closed: `true`
- Parent `#shopCompareModal.inert`: `false`
- Focus restored to: `#shopCompareInquiry`
- Remaining focus stack length: `1`

**Result: PASS.** The settled focus assertion is important: the focus assertion must wait for the dialog-focus transition to complete before sampling the state.

## 4. Tabbit: Apartment News explicit dialog/open assertion

Flow exercised at `390x844` on the same exact-main local server:

- News card trigger: `.news-row[data-story="meeting"]`
- Dialog locator: `#storyDialog`
- Explicit `toHaveAttribute('open', '')` assertion: PASS
- Native dialog `open` property: `true`
- Dialog open focus containment: `true`
- `DanjionDialogFocus.stack().length`: `1`
- Escape removes the `open` attribute/property: PASS
- Focus stack after close: `0`

**Result: PASS.**

## 5. Canonical Playwright

Executed from the exact-main worktree:

```text
DANJION_E2E_PORT=8766 ./node_modules/.bin/playwright test \
  --config=playwright-top-level-v3.config.ts \
  e2e-top-level-v3/dialog-focus-lifecycle-980.spec.ts \
  -g "Neighbor Shops"
```

- Test: `#980 Neighbor Shops keeps only the top nested sheet interactive and restores each parent trigger at 390px`
- Result: **1 passed**
- Duration reported by Playwright: `2.1s` test / `5.2s` total

The first wrapper invocation selected an unavailable/incorrect local port and was not used as evidence. The direct exact-main Playwright invocation above is the canonical passing run.

## 6. CENTRAL disposition

This exact current-main revalidation passes both the manual Tabbit assertions and the canonical Neighbor Shops test. The prior failure is therefore classified as a **stale/dirty local environment or stale served asset**, not a reproducible defect in exact current main.

Do not reopen #980 from this evidence and do not apply a source fix. If a later failure is observed, capture the worktree SHA, served asset hash, server port, and the settled focus state before comparing it with this baseline.
