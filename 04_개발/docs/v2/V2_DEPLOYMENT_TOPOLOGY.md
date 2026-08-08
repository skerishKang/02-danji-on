# DanjiOn V2 Deployment Topology

Status: V2-C implementation candidate / Draft / Do not merge
Parent issues: #25, #28, #30

## 1. Decision

Use one React/Vite repository and one existing Cloudflare Pages project, but deploy three independent preview branch aliases:

- V1: `https://v1.padiem-danjion-web-preview.pages.dev`
- V2: `https://v2.padiem-danjion-web-preview.pages.dev`
- Gateway: `https://gateway.padiem-danjion-web-preview.pages.dev`

This gives V1 and V2 separate URLs without creating two backend stacks or coupling both UI trees inside one runtime view.

## 2. Why one Pages project

The preview Worker currently allows origins matching:

`https://*.padiem-danjion-web-preview.pages.dev`

Using V1, V2 and Gateway as branch aliases under the same existing Pages project keeps the existing preview-only CORS boundary intact. No backend CORS broadening is required for this topology.

The gateway itself does not need private API access. V1 and V2 may both call the same Worker preview API.

## 3. UI build contract

Frontend environment:

```text
VITE_UI_VARIANT=v1|v2|gateway
```

Behavior:

- `v1` -> existing `App.tsx`
- `v2` -> V2 surface
- `gateway` -> version chooser
- unset/unknown -> V1

The default is deliberately V1 so existing local/dev/CI builds do not silently switch to V2.

Navigation URLs are public configuration, not secrets:

```text
VITE_V1_URL=https://v1.padiem-danjion-web-preview.pages.dev
VITE_V2_URL=https://v2.padiem-danjion-web-preview.pages.dev
VITE_GATEWAY_URL=https://gateway.padiem-danjion-web-preview.pages.dev
```

## 4. Current Track V2-C implementation state

Implemented on `feat/v2-c-gateway-routing`:

- safe `VITE_UI_VARIANT` parser;
- V1 as the default/fallback;
- isolated Gateway React surface;
- reusable cross-version link component;
- V1-only legacy DOM installer lifecycle;
- V2 integration-pending placeholder so routing can be tested before A/B integration;
- environment contract;
- preview workflow topology for three Pages branch aliases.

The V2 placeholder is intentionally not a V2 implementation and must never be reported as visual fidelity completion.

## 5. Shared Worker preview

The multi-surface workflow uploads one Worker preview version with alias:

`v2-program`

All V1/V2 API builds point to that same preview Worker URL.

Required DB secret is fail-closed:

`DANJION_PREVIEW_DATABASE_URL`

It must refer to the non-production Neon child preview branch defined by the existing Track E contract. Never substitute the production `DATABASE_URL` for V2 preview mutation testing.

## 6. Preview workflow trigger

`.github/workflows/cloudflare-v2-surface-preview.yml`

Automatic trigger is a push to the integration branch only:

`feat/v2-platform-20260808`

This is intentional. Individual A/B/C/D track branches must not publish shared V2 preview aliases while their outputs are incomplete.

When A/B/C/D are integrated on the umbrella branch, the workflow:

1. checks backend and frontend;
2. uploads the shared Worker preview version;
3. verifies the existing Pages project;
4. builds/deploys V1 branch alias;
5. builds/deploys V2 branch alias;
6. builds/deploys Gateway branch alias;
7. checks all three URLs;
8. verifies Worker health/database;
9. verifies CORS from V1 and V2 origins.

## 7. V1 protection

`App.tsx` and V1 CSS are not modified by Track V2-C.

The only shared entry change is `main.tsx`, which chooses a surface. Existing V1 DOM installers run only when `VITE_UI_VARIANT` resolves to `v1`; Gateway and V2 must own their own lifecycle.

An unset `VITE_UI_VARIANT` resolves to V1, preserving current behavior.

## 8. Integration handoff

V2-B owns the real `V2App.tsx`. During #30 integration, the integration owner replaces the temporary `V2IntegrationPending` mount in `main.tsx` with the fixed V2-B app after reviewing V2-A/B compatibility.

V2-A owns visual primitives and styles. V2-D validates the final three-surface topology after A/B/C are combined.

## 9. Hard boundaries

- Production Pages deploy: NONE
- Production Worker deploy: NONE
- Production DB mutation: NONE
- R2: NONE
- Auth provider decision: OUT OF SCOPE
- PR merge: NONE

## 10. Track verdict

Track V2-C may claim `V2_C_ROUTING_READY` only after its branch passes frontend CI/typecheck/build and the Draft PR records the fixed head.

The live multi-surface URLs are not claimed as deployed until #30 integration actually runs the preview workflow successfully.
