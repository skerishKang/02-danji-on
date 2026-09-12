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
  /v2-runtime/    V2 React runtime comparison build   (STATUS=COMPARISON_ONLY)
  /v3-current/    V3 static design authority          (STATUS=DESIGN_AUTHORITY)
  /legacy-a/      V5 responsive functional prototype  (STATUS=COMPARISON_ONLY)
  /legacy-b/      V7 silly-color prototype            (STATUS=COMPARISON_ONLY)
  /pr378/         PR #378 frozen artifact             (STATUS=COMPARISON_ONLY, DO-NOT-MERGE)
  ```

- The gateway grants **no** production authority: no entry carries `PRODUCTION`.
  Exactly one `DESIGN_AUTHORITY` (v3-current) anchors the surface; every other
  retained version is `COMPARISON_ONLY`.

- Every card shows: VERSION_NAME, SOURCE_SHA, SOURCE_REF, SOURCE_PATH, STATUS,
  FROZEN/MUTABLE, DO_NOT_MERGE, CAPTURED_AT.
- `X-Robots-Tag: noindex, nofollow` on every path — previews are never indexed
  and can never silently become production authority.

## Layout

```
design-gateway/
├─ registry/versions.json      # GATEWAY RUNTIME registry (danjion-design-registry-v1) — 5 versions, drives cards/build
├─ version-registry.json       # KILO2 PACKAGING registry (danjion-static-design-version/v1) — 4 frozen packages, provenance
├─ versions/<id>/              # KILO2 frozen read-only packages (v3-current, legacy-a, legacy-b, pr378)
├─ gateway/                    # landing shell (index.html, css, js, _headers)
├─ preview-bundles/<id>/       # mount points for KILO3 deliverables (v2-runtime)
├─ scripts/                    # registry-lib, build, check (node-only, zero deps)
├─ tests/                      # registry / integration / safety / build-output contracts
└─ INTEGRATION_CONTRACT.md     # how external bundles are mounted
```

## Two registries (reconciled, not merged)

The gateway deliberately keeps **two** registries with different vocabularies,
linked by matching version ids and `source.sha` provenance — a third is not
created:

- `registry/versions.json` — the **gateway runtime** registry (`danjion-design-registry-v1`,
  5 entries). Single source of truth for what the landing page and `build.mjs`
  emit. Statuses: `DESIGN_AUTHORITY` / `COMPARISON_ONLY` (no `PRODUCTION`).
- `version-registry.json` — KILO2's **packaging/provenance** registry
  (`danjion-static-design-version/v1`, 4 frozen packages). Validates the read-only
  `versions/<id>/` packages. Statuses: `DESIGN_AUTHORITY` / `COMPARISON_KEEP`.

They agree on the underlying artifacts (same `source_sha`/entry per version); the
`COMPARISON_ONLY` (runtime) vs `COMPARISON_KEEP` (packaging) naming is intentional.

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
| `assembled` | copied from a canonical in-repo directory at build time (read-only) | v3-current, legacy-a, legacy-b, pr378 (all from KILO2's `versions/<id>/` packages) |
| `mounted` | pre-built bundle dropped into `preview-bundles/<id>/` per INTEGRATION_CONTRACT | v2-runtime (KILO3 comparison build) |

All five bundles are currently `READY`. `mounted` bundles with `state: PENDING`
would be skipped by the build and shown as PENDING on the landing page — the
gateway ships and works before any external bundle exists.

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
