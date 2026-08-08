# DanjiOn V2 Integration Report

Status: IN PROGRESS / DRAFT / DO NOT MERGE
Integration issue: #30
Branch: `feat/v2-platform-20260808`

## Fixed sibling heads

- V2-A: `5a0ccb2399a026b1d14faebc2135aa1d0401edca` / PR #37 / `V2_A_VISUAL_READY`
- V2-B: `da34c41dbdeb62f20ac02b0a8e2bee49d173d3fb` / PR #36 / `V2_B_FLOW_READY`
- V2-C: `0a65c0be2732d24513631e0017550a05b62bd2f5` / PR #35 / `V2_C_ROUTING_READY`
- V2-D: `1974ce7469b28e271886863ca6e0232201049a2e` / PR #38 / `V2_D_QA_CONTRACT_READY`

No sibling PR was merged. Their fixed outputs were composed only on this dedicated integration branch.

## Integration choices

- V1 remains the default when `VITE_UI_VARIANT` is unset or invalid.
- V2 mounts a dedicated integrated React surface instead of `V2IntegrationPending`.
- V2 uses Track A's visual grammar and source-locked photography/scene model.
- V2 reuses the existing DataAdapter/AdminAdapter contracts for benefits, bookmarks, registration and approval materialization.
- The source-reference visual examples remain demo presentation data; approval rediscovery is accepted only after the existing adapter actually returns the materialized Business.
- V1 global CSS and legacy DOM installers remain V1-only.
- Gateway remains a separate surface/origin selector, not a runtime theme toggle.

## QA contract adjustments made at integration

- Added Track D data attributes to Track A topbar/hero/cinematic primitives.
- Added roving keyboard arrow selection to the cinematic tablist.
- Added a local image fallback for source photography so a remote photo failure does not collapse layout.
- Added an integrated V2 surface with the exact D source-copy section anchors and dialog flows.
- Dedicated integration CSS is scoped under `.v2-integrated-app`/V2 classes and does not edit V1 styles.

## Still required before a green verdict

1. strict frontend typecheck/build;
2. existing V1 full Playwright suite with the variant unset;
3. V2-D release gate across V1, invalid fallback, Gateway and V2 variants;
4. V2 responsive/accessibility/product-flow checks;
5. separate V1/V2/Gateway Preview deployment and smoke tests;
6. fixed integrated head and evidence update here and in #30.

No `V2_INTEGRATION_GREEN` or `V2_PREVIEW_READY` claim is made until those gates actually pass.

## Safety

- Production deploy: NONE
- Production DB mutation/seed: NONE
- Production Drive write: NONE
- Migration 001–008 changes: NONE
- R2: NONE
- Final login-provider decision: NONE
- PR merge: NONE
