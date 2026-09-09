# #278 Persistence Integration Guard

Date: 2026-09-09

## Product authority

- DESIGN_AUTHORITY = sibling latest final v3
- authority anchor = `a2e856de522f77793ced0718cf58ab4b2d210732`
- backend/API adapts to frontend
- no redesign, copy rewrite, CSS/layout change, or SHOP_DATA rewrite

## Discovery status

Discovery slice is complete on main `16d475c6210506d78540c2ca7d74691d77d9c2bc`.

Production DB / Worker / Stage 5-A bridge are complete. Do not reopen discovery semantics while landing persistence.

## Persistence PR inventory

### Server contracts

1. PR #285 — saved shops server contract
2. PR #286 — reviews/replies response contract
3. PR #287 — application/report server contract

All three are test/contract hardening only. They do not redesign the product UI.

### Frontend runtimes

4. PR #288 — saved shops bridge runtime
5. PR #289 — reviews/replies bridge runtime
6. PR #290 — application/report bridge runtime

All three intentionally defer product HTML wiring.

## Mandatory merge serialization

The frontend runtime PRs all modify `04_개발/frontend/package.json`.

Do not merge #288/#289/#290 as independent stale-base PRs.

Required order:

1. merge #285
2. merge #286
3. merge #287
4. merge-forward #288 onto fresh main, exact-head CI, merge
5. merge-forward #289 onto post-#288 main, preserve stage5b entry, exact-head CI, merge
6. merge-forward #290 onto post-#289 main, preserve stage5b + stage5c entries, exact-head CI, merge

At the end, `package.json` must retain all existing tests plus:

- `test:stage5a-live-contract-bridge`
- stage5b saved-shops runtime contract
- stage5c reviews runtime contract
- stage5d application/report runtime contract

If any earlier test entry disappears during conflict resolution: STOP.

## Saved shops authority

Server endpoints:

- `GET /api/v1/me/bookmarks`
- `POST /api/v1/me/bookmarks/:businessId`
- `DELETE /api/v1/me/bookmarks/:businessId`

Frontend policy:

- API-backed `api-<uuid>` card + authenticated 200 => server bookmark authority
- 401/403 => existing `danjion:savedShops` localStorage behavior
- network/5xx => degraded local mode; never claim server success
- static fallback keys never become server business IDs

HTML wiring must preserve current save button labels and visual behavior.

## Reviews / replies authority

Server endpoints:

- `GET /api/v1/complexes/:slug/businesses/:businessId/reviews`
- `POST /api/v1/complexes/:slug/businesses/:businessId/reviews`
- `PATCH /api/v1/complexes/:slug/businesses/:businessId/reviews/:reviewId`
- `DELETE /api/v1/complexes/:slug/businesses/:businessId/reviews/:reviewId`
- `POST /api/v1/complexes/:slug/businesses/:businessId/reviews/:reviewId/reply`

Boundary:

- review list/create/update/delete uses verified resident authority
- reply remains distinct business-owner authority
- static fallback business keys must never trigger server review writes
- auth/network failures fail closed; no fake local persistence for server review operations

## Owner application authority

Server endpoints:

- `GET /api/v1/me/business-applications`
- `POST /api/v1/me/business-applications`
- `PATCH /api/v1/me/business-applications/:id`

Rules:

- supports `Idempotency-Key`
- relation types: `resident`, `resident_family`, `neighbor`, `local`
- resubmit only from `changes_requested`
- owner application lane must never absorb recommendation/report routes

## Shop report / recommendation authority

Server endpoints:

- `GET /api/v1/me/shop-recommendations?complexSlug=...`
- `POST /api/v1/me/shop-recommendations`
- `PATCH /api/v1/me/shop-recommendations/:id`

Rules:

- relation types: `resident_family`, `neighbor`, `local`
- `resident` is invalid for recommendation/report
- approval does not make the reporter the business owner
- resubmit only from `changes_requested`

## Product wiring order

After all runtimes land:

1. saved shops HTML wiring
2. reviews/replies HTML wiring
3. owner application/report form wiring

Each wiring PR must be adapter-only and independently previewed.

## Absolute no-change surface

For every wiring PR:

- PRODUCT_COPY_CHANGED = NO
- CSS_CHANGED = NO
- SHOP_DATA_CHANGED = NO
- LAYOUT_CHANGED = NO
- DB_MUTATION = NO
- WORKER_DEPLOYED = NO unless a separate explicit deployment gate exists
- PAGES_PRODUCTION_DEPLOYED = NO unless separately approved
- SECRET_MUTATION = NO

## Issue lifecycle

Keep #278 OPEN until all three live persistence wiring slices are verified.

Use `Refs #278`; do not use `Closes #278` on intermediate PRs.
