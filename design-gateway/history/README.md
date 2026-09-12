# DanjiOn Full HISTORY / COMPARE Archive

This directory is KILO2's content/package handoff for issue #402. It is not the
root gateway implementation owned by KILO1 and it does not alter the production
Pages project.

- Gallery route: `/history/`
- Registry: `registry.json`
- New historical bundles: `bundles/<slug>/index.html`
- Existing gateway routes are linked, not copied: `/v3-current/`, `/legacy-a/`,
  `/legacy-b/`, `/v2-runtime/`, and `/pr378/`.
- Every route is static, mock/read-only, and noindex.
- PR #378 remains frozen and `DO_NOT_MERGE`; this archive does not modify or
  duplicate its snapshot.
