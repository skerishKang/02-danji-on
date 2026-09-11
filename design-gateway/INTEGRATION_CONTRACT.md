# Design Gateway Integration Contract — v1 (`danjion-design-integration-v1`)

How KILO2/KILO3 (and any future bundle producer) deliver a version bundle into
this gateway. The gateway repo area is owned by the gateway integrator (KILO1);
bundle producers deliver bundles, not gateway edits.

## Boundary rules

1. Bundle producers write **only** inside `design-gateway/preview-bundles/<versionId>/`
   in their PR. They do not edit `registry/versions.json`, `gateway/`, `scripts/`,
   or `tests/`. The integrator flips `state: PENDING → READY` (and updates
   attribution fields) in the same or a follow-up PR.
2. No production API origins, no production credentials, no live data.
   Comparison builds run on mock/read-only data.
3. A mounted bundle never gains authority: STATUS stays whatever the registry
   says. Promotion of any preview to authority is impossible through this
   contract.

## Bundle requirements (checked by `tests/integration-contract.mjs`)

| # | Requirement |
|---|---|
| B1 | Entry file is exactly `index.html` at the bundle root. |
| B2 | `BUILD_INFO.json` at the bundle root with `{ "sourceSha": "<40-hex>", "sourceRef": "<branch>", "builtAt": "<ISO date>", "builder": "<KILO lane id>" }`. `sourceSha` MUST equal the registry entry's `source.sha` (provenance pin). |
| B3 | All asset references are **relative** (`./…`, `../…`) — no absolute-root paths (`src="/…"`), because the bundle is served under an arbitrary subpath (`/<versionId>/`). For Vite builds use a relative base (`base: './'`). |
| B4 | No absolute `http(s)://` origins inside html/css/js — mock data only, nothing that can reach production. |
| B5 | Self-contained: everything the version needs lives inside the bundle directory. No references to files outside `preview-bundles/<versionId>/`. |
| B6 | Static artifact only. The gateway hosts no server-side code; Workers/Pages Functions are out of scope for previews. |
| B7 | No indexed tracking, no service workers, no background sync in preview bundles. |

## Delivery flow

```
KILO2/KILO3                          gateway integrator (KILO1)
────────────                         ─────────────────────────
build bundle (relative base,         review bundle vs B1–B7,
mock data, BUILD_INFO.json)          mount at preview-bundles/<id>/,
PR touching only their               flip registry state PENDING→READY,
preview-bundles/<id>/ dir  ────────► run check + build + verify,
                                     set source.sha/ref to the exact
                                     built-from commit
```

## Current mount points

| versionId | producer | expected bundle |
|---|---|---|
| `v2-runtime` | KILO2 | `04_개발/frontend` V2 React built with relative base + mock/read-only data mode |
| `pr378` | integrator | frozen `frontend/` snapshot at `deploy/v3-preview` head `b618cad4…` (branch never merged) |

`v3-current`, `legacy-a`, `legacy-b` use `mode: assembled` (build-time copy
from canonical in-repo paths) and need no producer bundle.

## Registry fields exposed on gateway cards

VERSION_NAME (`name`) · SOURCE_SHA (`source.sha`) · SOURCE_REF (`source.ref`) ·
SOURCE_PATH (`source.path`) · STATUS (`status`: PRODUCTION | DESIGN_AUTHORITY |
COMPARISON_ONLY | ARCHIVED) · FROZEN (`frozen`) · DO_NOT_MERGE (`doNotMerge`) ·
CAPTURED_AT (`source.capturedAt`)
