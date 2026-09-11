# KILO2 #395 Static Design Version Packaging Report

Baseline: `f23c4e1f5622a2313c51c94d2ac54df568b2ea9a`
Branch: `kilo2/395-static-design-version-packager`
Mode: `STATIC_DESIGN_VERSION_PACKAGER`

## Retained set

Five independently addressable static bundles were retained:

1. `v2-runtime` — `COMPARISON_KEEP`; exact-main React V2 build output, built with `vite build --base ./` for subpath-safe relative assets. Production React V2 source was not modified.
2. `v3-current` — `DESIGN_AUTHORITY`; current static `frontend/` V3 entry and required static pages/assets, excluding V2 and comparison launcher variants.
3. `legacy-a` — `COMPARISON_KEEP`; canonical V5 responsive functional prototype from `03_HTML결과물/05_실사사진중심_v5/01_단지온_v5_반응형기능기준.html`.
4. `legacy-b` — `COMPARISON_KEEP`; V7 Silly Color System keyart from `03_HTML결과물/08_실리나이스_다색기능_v7/01_단지온_v7_실리나이스_다색기능.html`.
5. `pr378` — `COMPARISON_KEEP`; frozen PR #378 `[최종-v3]/` tree at `b618cad4abb4d966181f3ab7fcac2e7c2ebcc7f3`, marked `DO_NOT_MERGE`.

The registry records for every retained version: `VERSION_ID`, display name, source path/ref/SHA, entry file, build/copy method, frozen status, merge boundary, and known limitations. `bundle-manifest.json` records SHA-256 and byte size for all 165 retained files.

## Candidate classification

- `frontend/index2.html`, `app2.html`, V2 shop/benefit variants: `ARCHIVE_ONLY`.
- `frontend/00_APP_390_통합검토.html`, `00_주민혜택_AB비교.html`: `DUPLICATE_DROP` review launchers.
- `03_HTML결과물` v1, v2, v3, v4, v6, and M1 families: `ARCHIVE_ONLY` unless represented by the minimum retained set.
- V5 reference companion: `DUPLICATE_DROP`.
- V7 second HTML file: `DUPLICATE_DROP`, byte-identical to selected V7 file.
- `02_디자인팀` typography/token/exploration packs: `ARCHIVE_ONLY`.
- `04_개발/frontend/src/v2`: `DESIGN_AUTHORITY` for production React V2, but deliberately not copied or changed by this packaging branch.

## Bundle safety

- Gateway implementation is not included; only independently addressable bundle directories and registry/validation metadata are added.
- No production React V2 source, route, build config, Pages config, or KILO1 gateway code was modified.
- No production API write was executed.
- No production secret was read, embedded, or used.
- No production endpoint or credential assignment was found in the retained artifacts.
- Bundles are static snapshots with no injected API base. The V3 source may contain optional query-driven bridge code; a future gateway must not inject a production API base or credentials into these comparison artifacts.
- PR #378 remains frozen comparison material. Its source `app.html` referenced missing `index3.html`; the bundle adds a byte-identical frozen alias so the retained copy is self-contained without changing PR #378.

## Validation

- Exact baseline verified: `f23c4e1f5622a2313c51c94d2ac54df568b2ea9a`.
- Exact-main React V2 build: PASS.
- Subpath-safe V2 rebuild with `--base ./`: PASS.
- Registry validator: PASS, `retained=5`, `files=165`.
- Local HTML relative-reference validation: PASS, `missing=0`.
- Production credential/endpoint safety scan: PASS, `hits=0`.
- Bundle SHA manifest generation: PASS.
- `git diff --check`: PASS.
- Protected production source/gateway/workflow diff: empty.

## Required disposition

`MERGE=NO`

`DEPLOY=NO`

Draft PR only. The bundles are prepared for later KILO1 gateway integration review; this branch does not implement or deploy the gateway.
