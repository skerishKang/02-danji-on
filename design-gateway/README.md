# DanjiOn Design Gateway (#395) — NON-PRODUCTION

단지온 디자인 버전들을 한 곳에서 비교·검토하기 위한 **비운영 전용 게이트웨이**.
운영 Pages 프로젝트(`danjion`)와 운영 프론트엔드 권한(`04_개발/frontend`),
V3 스태틱 권한(`frontend/`)은 이 디렉터리의 어떤 변경으로도 영향을 받지 않는다.

## What this is

- A registry-driven static gallery published to a **dedicated non-production
  Cloudflare Pages project** (working name `danjion-design`, final hostname
  decided at the deployment gate).
- Each retained design version lives at a **stable subpath** of the gateway:

  ```
  /               landing (version cards)
  /v2-runtime/    V2 React runtime comparison build   (STATUS=PRODUCTION)
  /v3-current/    V3 static design authority          (STATUS=DESIGN_AUTHORITY)
  /legacy-a/      archived V2 static variant          (STATUS=ARCHIVED)
  /legacy-b/      html-result v5 comparison variant   (STATUS=COMPARISON_ONLY)
  /pr378/         PR #378 frozen artifact             (STATUS=COMPARISON_ONLY, DO-NOT-MERGE)
  ```

- Every card shows: VERSION_NAME, SOURCE_SHA, SOURCE_REF, SOURCE_PATH, STATUS,
  FROZEN/MUTABLE, DO_NOT_MERGE, CAPTURED_AT.
- `X-Robots-Tag: noindex, nofollow` on every path — previews are never indexed
  and can never silently become production authority.

## Layout

```
design-gateway/
├─ registry/versions.json      # single source of truth (danjion-design-registry-v1)
├─ gateway/                    # landing shell (index.html, css, js, _headers)
├─ preview-bundles/<id>/       # mount points for KILO2/KILO3 deliverables
├─ scripts/                    # registry-lib, build, check (node-only, zero deps)
├─ tests/                      # registry / integration / safety / build-output contracts
└─ INTEGRATION_CONTRACT.md     # how external bundles are mounted
```

## Commands

```
node scripts/check.mjs    # 3 source contracts (fail-fast, deterministic)
node scripts/build.mjs    # assembles dist/ (gateway shell + registry + READY bundles)
node tests/build-output-contract.mjs   # verifies dist layout after build
```

CI: `.github/workflows/design-gateway-ci.yml` runs all of the above on any
change under `design-gateway/**`. **CI never deploys.**

## Bundle modes

| mode | source | used by |
|---|---|---|
| `assembled` | copied from a canonical in-repo directory at build time (read-only) | v3-current, legacy-a, legacy-b |
| `mounted` | pre-built bundle dropped into `preview-bundles/<id>/` per INTEGRATION_CONTRACT | v2-runtime (KILO2), pr378 (frozen PR artifact) |

`mounted` bundles with `state: PENDING` are skipped by the build and shown as
PENDING on the landing page — the gateway ships and works before any external
bundle exists.

## Adding / changing a version

1. Edit `registry/versions.json` (one entry per version; schema is enforced).
2. Static in-repo sources → `mode: assembled`. External/pre-built bundles →
   `mode: mounted` + deliver the bundle per `INTEGRATION_CONTRACT.md`.
3. Run `node scripts/check.mjs && node scripts/build.mjs && node tests/build-output-contract.mjs`.
4. PR review by the gateway integrator (KILO1). Bundle producers do **not**
   edit the registry or gateway shell directly.

## Deployment gate (NOT part of this PR)

Publishing is a separate, explicitly approved action after CENTRAL review:

```
node scripts/build.mjs
npx wrangler pages deploy design-gateway/dist --project-name danjion-design   # dedicated non-production project only
```

Hard boundaries, enforced by `tests/safety-contract.mjs`:
- the production Pages project is never a deploy target of this area
- no production origins or credentials may appear anywhere in this directory
- no preview may mutate production data; bundles use mock/read-only data only
- PR #378 stays DO-NOT-MERGE; this gateway only exposes its frozen artifact
