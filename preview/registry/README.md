# DanjiOn preview version registry

Bounded directory consumed by the KILO1 preview gateway (#397). Each
`*.json` file here describes exactly one version bundle. The gateway may
mount these bundles read-only; nothing in `preview/` is ever a deployment
target, and `danjion.pages.dev` remains the only production surface.

## Record contract (KILO1 gateway, #397)

| Field | Meaning |
| --- | --- |
| `VERSION_NAME` | stable id used in the gateway picker |
| `SOURCE_SHA` | full 40-hex source authority commit (main) the app sources were built from — not the preview branch head |
| `SOURCE_PATH` | workspace path of the built app |
| `SOURCE_BRANCH` | branch containing the build |
| `BUILD_SHA` | preview branch head the artifact was built from |
| `CREATED_AT` | ISO-8601 build timestamp |
| `STATUS` | `PRODUCTION` \| `DESIGN_AUTHORITY` \| `COMPARISON_ONLY` \| `ARCHIVED` |
| `MUTABLE` | `YES` \| `NO` |
| `DO_NOT_MERGE` | explicit merge posture for the record's source |

Additional KILO3 fields: `SUBPATH` (mount point), `BUNDLE_PATH` (relative
to repo root), `MOUNT_PATH` (`design-gateway/preview-bundles/v2-runtime`),
`BUILD_INFO_PATH` (B2 provenance marker inside the mount), `BUILDER`
(`KILO3`), `GATEWAY_CONSUMER` (`KILO1_PR399`), `BUILD_COMMAND`,
`DATA_MODE`/`AUTH_MODE`/`STORAGE_MODE`/`API_BASE` (safety profile),
`HOSTNAME_ALLOWLIST`, `SERVES_PRODUCTION_TRAFFIC`.

## v2-runtime.json (KILO3 #395)

- COMPARISON_ONLY React V2 bundle, gateway-contract shaped (KILO1 #399
  INTEGRATION_CONTRACT B1–B7): relative `./` asset base, no absolute
  `http(s)://` origins in html/css/js (JS string origins are `\u002F`-escaped
  at build time, runtime values unchanged; external webfont `@import` is
  stripped), no service worker (`demo-sw.js` dropped, registration stubbed),
  noindex + COMPARISON ONLY overlay baked in.
- Regenerate with: `node 04_개발/scripts/v2-runtime-preview.mjs build`
  (sanitized env: mock data, dev auth, relative `/api`; live/secret env
  vars are deleted before vite runs; the built bundle is scanned for
  production host leakage and re-scanned against the mirrored B1–B7 rules).
- KILO1 handoff: the build packages the exact artifact into
  `design-gateway/preview-bundles/v2-runtime/` with a `BUILD_INFO.json`
  whose `sourceSha` equals the gateway registry `source.sha`
  (authority main). `SOURCE_SHA` defaults to `merge-base(HEAD, origin/main)`
  and the build fails if `04_개발/frontend/src` drifts from that pin.
- Serve locally for QA: `node 04_개발/scripts/v2-runtime-preview.mjs serve`
  → `http://127.0.0.1:4185/v2-runtime/` (serves the mounted bundle itself).
- The working copy also lands in `04_개발/frontend/dist-v2-runtime-preview/`
  (gitignored). The bundle must never be pointed at the production Pages
  project.
- Contract test: `npm run test:v2-runtime-preview-contract` (frontend; runs
  in CI via `test-runner.manifest.json`).
