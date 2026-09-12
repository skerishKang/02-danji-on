# preview-bundles

Mount points for externally produced version bundles (KILO3) per
`../INTEGRATION_CONTRACT.md`. One directory per **mounted** version id.

- Currently only `v2-runtime/` is mounted here (KILO3 comparison build, `READY`,
  `index.html` + `BUILD_INFO.json`).
- `v3-current`, `legacy-a`, `legacy-b`, `pr378` are `assembled` from KILO2's
  frozen packages under `../versions/<id>/` and have **no** directory here.
- Empty (`.gitkeep` only) while a mounted bundle's registry state is `PENDING`.
- A `READY` bundle must contain `index.html` + `BUILD_INFO.json` and satisfy
  contract rules B1–B7.
- Directories here that are not in `registry/versions.json` fail the
  integration contract (no unmanaged previews).
