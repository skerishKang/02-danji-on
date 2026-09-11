# DanjiOn preview version registry

Bounded directory consumed by the KILO1 preview gateway (#397). Each
`*.json` file here describes exactly one version bundle. The gateway may
mount these bundles read-only; nothing in `preview/` is ever a deployment
target, and `danjion.pages.dev` remains the only production surface.

## Record contract (KILO1 gateway, #397)

| Field | Meaning |
| --- | --- |
| `VERSION_NAME` | stable id used in the gateway picker |
| `SOURCE_SHA` | full git sha the bundle was built from |
| `SOURCE_PATH` | workspace path of the built app |
| `SOURCE_BRANCH` | branch containing that sha |
| `CREATED_AT` | ISO-8601 build timestamp |
| `STATUS` | `PRODUCTION` \| `DESIGN_AUTHORITY` \| `COMPARISON_ONLY` \| `ARCHIVED` |
| `MUTABLE` | `YES` \| `NO` |
| `DO_NOT_MERGE` | explicit merge posture for the record's source |

Additional KILO3 fields: `SUBPATH` (mount point), `BUNDLE_PATH` (relative
to repo root), `BUILD_COMMAND`, `DATA_MODE`/`AUTH_MODE`/`STORAGE_MODE`/
`API_BASE` (safety profile), `SERVES_PRODUCTION_TRAFFIC`.

## v2-runtime.json (KILO3 #395)

- COMPARISON_ONLY React V2 bundle served under `/v2-runtime/`.
- Regenerate with: `node 04_개발/scripts/v2-runtime-preview.mjs build`
  (sanitized env: mock data, dev auth, relative `/api`; live/secret env
  vars are deleted before vite runs and the built bundle is scanned for
  production host leakage).
- Serve locally for QA: `node 04_개발/scripts/v2-runtime-preview.mjs serve`
  → `http://127.0.0.1:4185/v2-runtime/`.
- The built bundle itself lives in `04_개발/frontend/dist-v2-runtime-preview/`
  (gitignored artifact). KILO1 copies it into the gateway's bounded
  directory; it must never be pointed at the production Pages project.
- Contract test: `npm run test:v2-runtime-preview-contract` (frontend).
