# DanjiOn V2 Fidelity / QA Gate

Status: `V2_D_QA_CONTRACT_READY`  
Issue: #29  
Branch: `feat/v2-d-fidelity-qa`  
Integration branch: `feat/v2-platform-20260808`  
Policy: DRAFT / DO NOT MERGE

## 1. Purpose

This gate answers one question after the V2-A/B/C sibling outputs are integrated:

> Does the React V2 preserve the fixed image-refresh prototype's product/visual interaction contract **without regressing V1 or the Gateway safety boundary**?

V2-D does not redesign or implement the V2 UI. It supplies assertions, fixtures, and source-grounded acceptance criteria only.

## 2. Fixed source inputs

Canonical source:

- Drive file: `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`
- Drive id: `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB`
- required SHA256: `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`

V2-D downloaded the raw HTML and independently calculated the same SHA256 before writing the gate. The source lock therefore matches the V2 program work order.

Sibling evidence analyzed before writing tests:

- `SHA256.txt` — locks the canonical HTML, eight scene WebPs, icon sprite and manifest;
- `05_실행자산/scene-food.webp`;
- `scene-learning.webp`;
- `scene-home-care.webp`;
- `scene-professional.webp`;
- `scene-craft.webp`;
- `scene-car.webp`;
- `scene-beauty.webp`;
- `scene-photo.webp`;
- `05_실행자산/ui-icons.svg`;
- `이미지출처_및_교체내역.md` — confirms photo-only refresh while layout/function/motion/copy stay fixed;
- execution recording `녹화-11_8월현장시연_통합시제품_v1_이미지리프레시.mp4`, Drive id `13kpM0HeS_WG9lXbuWk9uVvbBConKJ6ai`, 1920×1080, 30fps, 115.472834 seconds.

The recording was sampled across the full duration to corroborate the source flow. The HTML remains the source of truth when copy/DOM behavior and the recording differ.

## 3. Existing V1 regression suite analyzed

The current V1 Playwright baseline is preserved and run unchanged before V2-specific tests at integration time.

Reviewed inputs — complete current V1 Playwright inventory, **13 spec files / 35 tests** as confirmed by the PR Playwright report:

- `frontend/playwright.config.ts`;
- `e2e/accessibility.spec.ts`;
- `e2e/benefit-wallet.spec.ts`;
- `e2e/demo-rehearsal.spec.ts`;
- `e2e/field-demo-cycle.spec.ts`;
- `e2e/field-demo-visual.spec.ts`;
- `e2e/live-release.spec.ts`;
- `e2e/mobile.spec.ts`;
- `e2e/operations-parity.spec.ts`;
- `e2e/promo-materials.spec.ts`;
- `e2e/resident-admin-flow.spec.ts`;
- `e2e/resident-verification.spec.ts`;
- `e2e/resilience.spec.ts`;
- `e2e/verification-accessibility.spec.ts`.

They already protect:

1. resident and operations primary surfaces against serious/critical WCAG axe violations;
2. deterministic field-demo reset, session recovery, last-surface restore, temporary offline survival and captured runtime error evidence;
3. search → detail → bookmark → verified contact disclosure;
4. field-demo visual baseline with four real working-scene tabs, manual scene persistence and reduced-motion image behavior;
5. changes-requested application → correction → resubmit/audit;
6. resident submission → image → promo material generation → operations public/private review → approval → published-count increment → public rediscovery → living-economy ending;
7. three promotion outputs using uploaded imagery or a working-scene fallback, explicitly rejecting emoji artwork regression;
8. operator review privacy: public data separated from resident relationship evidence, without exposing building/unit or evidence object key;
9. admin news/benefit → resident visibility;
10. resident verification approval/rejection/reapply plus axe checks on resident and operations verification surfaces;
11. benefit claim/store/use, idempotency and detail-state reflection;
12. empty-search state, required-field blocking, non-image upload rejection and double-review prevention;
13. mobile navigation and horizontal overflow;
14. Scene 08 ending across eight widths from 1440 down to 320 without horizontal overflow;
15. release surfaces avoiding 5xx/horizontal overflow.

V2-D adds V2 contracts **on top of** these tests. It does not replace them.

## 4. Test inventory

### Reference fixture / helpers

- `frontend/tests/v2/reference-contract.ts`
  - fixed source id/SHA;
  - reference copy, scenes, filters, registration steps and promo outputs;
  - desktop/tablet/mobile viewport definitions;
  - semantic selector fallbacks for integrated React and source-equivalent structures.
- `frontend/tests/v2/v2-test-helpers.ts`
  - hard rejection of `V2IntegrationPending`;
  - first-viewport assertion;
  - horizontal-overflow assertion;
  - keyboard focus visibility;
  - long-animation detection for reduced motion.

### `v2-fidelity.spec.ts`

Checks:

- fixed topbar;
- first-screen editorial hero/search;
- substantial real-photo hero composition;
- four cinematic scenes;
- scene selection, `aria-selected`, arrow-key navigation and category color change;
- desktop/tablet sticky cinematic behavior and mobile non-sticky behavior;
- source section order: discovery → benefits → registration → promo → ending.

### `v2-product-flow.spec.ts`

Checks:

- search (`에어컨`) → `온케어 홈서비스` → detail;
- category + resident-relation filters;
- detail content/privacy action boundary;
- benefit claim → generated code → stored → My Info → used;
- four-step registration;
- promotion-material generation;
- public/private operator review;
- approval → rediscovery of newly registered work.

### `v2-responsive-accessibility.spec.ts`

Checks on V2 projects:

- 1440×1000 desktop;
- 1024×900 tablet;
- 390×844 mobile;
- 320×720 minimum-width mobile.

Assertions:

- first-screen search remains inside initial viewport;
- no horizontal overflow;
- mobile nav only at mobile breakpoint;
- sticky cinematic behavior does not survive into <=800 mobile flow;
- keyboard Tab reaches search with visible focus;
- scene tabs support ArrowRight selection;
- opening detail via keyboard transfers focus to dialog close control;
- `@axe-core/playwright` reports no serious/critical violations on the main surface;
- `prefers-reduced-motion: reduce` removes long decorative animation and sticky scroll scene while scene selection remains functional.

### Gateway/V1 safety

- `v2-gateway-safety.spec.ts`
  - gateway root is isolated;
  - V1/V2 destinations are both present and use configured URLs;
  - gateway does not masquerade as V1/V2 product surface;
  - no horizontal overflow.
- `v2-v1-safety.spec.ts`
  - V1 root still has `#home-search`;
  - no V2/Gateway root or V2 pending copy;
  - no horizontal overflow.

## 5. Dedicated Playwright configuration

`frontend/tests/v2/playwright.v2.config.ts` deliberately lives outside the current V1 `e2e` testDir, so V2-D does not alter the existing V1 Playwright configuration.

Target variants:

```text
DANJION_V2_TARGET_VARIANT=v1
DANJION_V2_TARGET_VARIANT=invalid
DANJION_V2_TARGET_VARIANT=gateway
DANJION_V2_TARGET_VARIANT=v2
```

Local ports used by the D-only preview launcher:

```text
v1       4181
v2       4182
gateway  4183
invalid  4184
```

Remote integrated preview checks can bypass the local server with:

```text
DANJION_V1_BASE_URL=https://...
DANJION_V2_BASE_URL=https://...
DANJION_GATEWAY_BASE_URL=https://...
```

No production URL is embedded in the test contract.

## 6. Gate execution

### Current D branch / prepare mode

```bash
node 04_개발/scripts/v2-fidelity-gate.mjs
```

The script first checks for A/B/C/D integration prerequisites. Missing sibling output is reported as explicit `BLOCKED_V2_*` lines. Prepare mode exits successfully after reporting blockers so the D contract can be reviewed independently.

Expected current verdict before #30 integration:

```text
V2_D_QA_CONTRACT_READY
```

This is **not** a fidelity PASS.

### Integrated candidate / release mode

After #30 pins and integrates fixed A/B/C/D heads:

```bash
DANJION_V2_GATE_MODE=release \
node 04_개발/scripts/v2-fidelity-gate.mjs --release
```

Release mode fails if any integration prerequisite is absent, including a surviving `V2IntegrationPending` mount.

If prerequisites are present, execution order is:

1. frontend typecheck;
2. existing V1 Playwright suite unchanged, with `VITE_UI_VARIANT` explicitly unset;
3. explicit V1 build/safety gate;
4. invalid variant → V1 fallback gate;
5. Gateway isolation/link gate;
6. V2 desktop/tablet/390/320 fidelity, product-flow, responsive, keyboard/focus, axe and reduced-motion gates.

Only that integrated run may emit:

```text
V2_FIDELITY_GATE_PASS
```

Even that is a V2 integration QA result, **not** `PRODUCTION_READY`.

## 7. Mandatory blocker semantics

A/B/C are siblings, not assumptions.

| Blocker | Meaning |
|---|---|
| `BLOCKED_V2_A` | visual primitives / visual CSS absent; hero/cinematic/responsive fidelity cannot be executed |
| `BLOCKED_V2_B` | `V2App` / product flows absent; search/detail/benefit/registration/promo/operator loop cannot be executed |
| `BLOCKED_V2_C` | variant/router/gateway output absent; V1 default/Gateway link safety cannot be executed |
| `BLOCKED_V2_C+B` | C still mounts `V2IntegrationPending` rather than the integrated B app |
| `BLOCKED_V2_D` | D's own required test/doc contract is incomplete |

No blocker can be replaced with a mock PASS. A/B/C must be fixed, integrated outputs on #30.

## 8. Pass criteria after integration

All of the following are required for a V2 fidelity gate PASS:

1. source lock remains the fixed Drive id/SHA;
2. A/B/C/D fixed heads are present on the integration commit;
3. `main.tsx` no longer mounts `V2IntegrationPending` for V2;
4. unset and invalid variants render V1;
5. existing V1 Playwright suite remains green;
6. V2 hero/topbar/search and real-photo composition pass;
7. four-scene cinematic system passes selection, responsive and reduced-motion gates;
8. discovery/search/filter/detail passes;
9. benefit claim/store/use passes;
10. registration → promo → public/private review → approval → rediscovery passes;
11. 1440/1024/390/320 have no horizontal overflow;
12. first-screen search is visible in initial viewport at all four V2 widths;
13. keyboard/focus checks pass;
14. axe has no serious/critical main-surface violations;
15. Gateway V1/V2 links are correct and isolated;
16. no production component/backend/schema/migration/secret/deploy changes are introduced by D.

A visual-review follow-up should still compare final screenshots against the fixed HTML/recording for fine-grained typography, image crop and animation timing. Automated checks intentionally target structural fidelity and critical interaction behavior rather than brittle full-page pixel equality.

## 9. Artifacts

When the dedicated config executes in CI or locally:

- HTML report: `04_개발/frontend/playwright-report/v2-<variant>`;
- raw test output: `04_개발/frontend/test-results/v2-<variant>`;
- trace/screenshots/video: retained on failure by Playwright configuration.

The existing V1 report path remains untouched.

## 10. Safety and ownership

V2-D changes only its locked ownership surfaces:

- `04_개발/frontend/tests/v2-*.spec.ts`;
- `04_개발/frontend/tests/v2/**`;
- `04_개발/docs/v2/V2_PARITY_MATRIX.md`;
- `04_개발/docs/v2/V2_QA_GATE.md`;
- `04_개발/scripts/v2-*`.

V2-D does **not** edit:

- V1 `App.tsx` / V1 styles;
- V2-A/B/C implementation files;
- backend/API/Auth/storage;
- migrations `001`–`008`;
- production deployment config;
- secrets.

Production DB write: **NONE**  
Production Drive write: **NONE**  
Production deploy: **NONE**  
Merge: **NONE**

## 11. Current verdict

A/B/C are not yet integrated into the V2 platform branch, so overall fidelity is intentionally:

# `BLOCKED_A_B_C_INTEGRATION`

V2-D deliverable verdict:

# `V2_D_QA_CONTRACT_READY`

Do not change this to a fidelity PASS on the D branch alone.
