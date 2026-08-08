# DanjiOn V2 Integration Report

Status: `V2_INTEGRATION_GREEN` / `V2_UI_PREVIEW_READY` / `LIVE_API_PREVIEW_BLOCKED`
Integration issue: #30
Integration PR: #39
Branch: `feat/v2-platform-20260808`
Code evidence commit: `423a14d180df023d30d6a7cd498d960d027b8e8a`

## Fixed sibling heads

- V2-A: `5a0ccb2399a026b1d14faebc2135aa1d0401edca` / PR #37 / `V2_A_VISUAL_READY`
- V2-B: `da34c41dbdeb62f20ac02b0a8e2bee49d173d3fb` / PR #36 / `V2_B_FLOW_READY`
- V2-C: `0a65c0be2732d24513631e0017550a05b62bd2f5` / PR #35 / `V2_C_ROUTING_READY`
- V2-D: `1974ce7469b28e271886863ca6e0232201049a2e` / PR #38 / `V2_D_QA_CONTRACT_READY`

No sibling PR was merged. Their fixed outputs were composed only on the dedicated integration branch.

## Integration result

- V1 remains the default when `VITE_UI_VARIANT` is unset or invalid.
- V2 mounts a dedicated integrated React surface instead of `V2IntegrationPending`.
- V2 uses Track A's source-locked hero/cinematic visual grammar and real-photo model.
- V2 reuses existing DataAdapter/AdminAdapter contracts for bookmarks, benefits, business registration, admin review and approval materialization.
- Approval rediscovery is accepted only after the existing adapter returns the materialized Business; V2 does not fabricate an approved business locally.
- V1 global CSS and legacy DOM installers remain V1-only.
- Gateway remains a separate comparison surface/origin selector rather than a runtime theme toggle.
- The final login-provider decision remains outside this V2 integration.

## Integration fixes required by the D gate

The first integrated candidates exposed interface mismatches rather than backend/schema defects. They were fixed on the integration branch before the green verdict:

- Track A hero/topbar/cinematic primitives were given the D-owned QA hooks.
- Cinematic controls remain native buttons and support ArrowLeft/ArrowRight/Home/End selection.
- Programmatic browser scrolling no longer unintentionally changes the first cinematic scene; actual user scroll intent still drives scene progression.
- Registration dialog headings were normalized for accessible heading/focus assertions.
- Source photography has a local layout-preserving fallback.
- The category panel background switches deterministically while the larger cinematic dark field/image motion still carries the transition, removing a prior timing flake.

## Final D release-gate evidence

GitHub Actions: **V2 Integration Gate #21 — SUCCESS** on `423a14d180df023d30d6a7cd498d960d027b8e8a`.

- fixed source ID/SHA lock: PASS
- strict TypeScript typecheck: PASS
- existing V1 Playwright with `VITE_UI_VARIANT` unset: **35/35 PASS**
- explicit V1 / invalid->V1 / Gateway safety subruns: **2/2 + 2/2 + 2/2 PASS**
- full V2 fidelity/product-flow/responsive/accessibility suite: **40/40 PASS**
- emitted verdict: `V2_FIDELITY_GATE_PASS`
- flaky retries in the final run: **0**

The build still prints the pre-existing warning that `/field-demo/neighbor-scenes-sprite.webp` is left for runtime resolution. This warning is not the V2 local fallback (`/field-demo/scenes-sprite.jpg`) and did not fail V1 or V2 gates.

## Other CI at the same code evidence commit

- Frontend CI #406 — SUCCESS
- Resident Verification CI #136 — SUCCESS
- Pre-Infra Integration CI #291 — SUCCESS
- legacy Track E Cloudflare Preview #44 — SKIPPED by branch scope, as intended

## Multi-surface Cloudflare UI Preview

GitHub Actions: **Cloudflare V1 V2 Gateway Preview #22 — SUCCESS**.

Stable comparison aliases:

- V1: `https://v1.padiem-danjion-web-preview.pages.dev`
- V2: `https://v2.padiem-danjion-web-preview.pages.dev`
- Gateway: `https://gateway.padiem-danjion-web-preview.pages.dev`

The workflow built all three surfaces independently, deployed them to the existing `padiem-danjion-web-preview` Pages project, and smoke-tested all three aliases successfully.

### Preview profile used in this run

`UI_ONLY_MOCK`

`DANJION_PREVIEW_DATABASE_URL` is not currently configured in GitHub Actions. The workflow therefore fail-safely skipped Worker upload and database access, used existing mock adapters for V1/V2 UI comparison, and performed **no database access or mutation**.

This is intentional and is not reported as a live API/Auth preview.

## What remains blocked

`LIVE_API_PREVIEW_BLOCKED` remains until a **non-production Neon child branch connection secret** is configured as `DANJION_PREVIEW_DATABASE_URL`. Do not substitute the existing production `DATABASE_URL`.

Separately, final browser login/session integration is still an Auth decision/implementation gate. The V2 UI integration does not claim Google/email login, resident identity verification, or protected live write flows are runtime-complete.

## Verdicts

- `V2_INTEGRATION_GREEN` — YES
- `V2_FIDELITY_GATE_PASS` — YES
- `V2_UI_PREVIEW_READY` — YES
- `V2_LIVE_API_PREVIEW_READY` — NO
- `PRODUCTION_READY` — NO

## Safety

- Production deploy: NONE
- Production DB access in final UI-only preview: NONE
- Production DB mutation/seed: NONE
- Production Drive write: NONE
- Migration 001–008 changes: NONE
- R2: NONE
- Final login-provider decision: NONE
- Sibling PR merge: NONE
- Integration PR merge: NONE

**DRAFT / DO NOT MERGE.**
