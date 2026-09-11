# preview-bundles

Mount points for externally produced version bundles (KILO2/KILO3) per
`../INTEGRATION_CONTRACT.md`. One directory per registered version id.

- Empty (`.gitkeep` only) while the registry state is `PENDING`.
- A `READY` bundle must contain `index.html` + `BUILD_INFO.json` and satisfy
  contract rules B1–B7.
- Directories here that are not in `registry/versions.json` fail the
  integration contract (no unmanaged previews).
