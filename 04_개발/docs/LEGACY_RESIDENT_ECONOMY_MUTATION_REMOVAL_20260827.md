# Legacy resident-economy mutation removal — 2026-08-27

## Status

Design-independent backend hardening stacked on PR #130 accepted head:

`cbef998d87cfc3bc46cafd52807173229b548dde`

Issue: #131

## Why this cleanup exists

The current application router already sends sensitive resident-economy mutations to `resident-economy-v2.ts` before historical handlers. That protected current requests, but executable fallback implementations still existed below the current handler.

Those dormant implementations used historical `complex_memberships` authority and could become reachable after a future routing/refactor regression.

`CURRENT_INTERCEPTION != SAFE_DORMANT_AUTHORITY`

## Sole current mutation owner

`resident-economy-v2.ts` remains the sole runtime owner of:

- `POST /api/v1/me/business-applications`
- `PATCH /api/v1/me/business-applications/:id` for changes-requested resubmit
- `POST /api/v1/me/benefits/:benefitId/claim`

Those mutations continue to consume current Household-v2 verified-resident authority and all later business-image integrity/lifecycle protections.

## Removed dormant paths

### `resident-application-v1.ts`

Removed:

- legacy business-application POST
- legacy changes-requested PATCH resubmit
- legacy `complex_memberships` create authority
- duplicate mutation/idempotency/input-normalization implementation

Preserved:

- applicant-owned GET detail

### `benefit-wallet-v1.ts`

Removed:

- legacy benefit claim POST
- `requireVerifiedMembership()`
- legacy verified `complex_memberships` claim authority

Preserved:

- actor-owned wallet GET
- actor-owned stored-claim PATCH use

### `core-v1.ts`

Removed:

- fallback POST `/api/v1/me/business-applications`
- fallback `insert into business_applications` mutation

Preserved:

- business-application collection GET
- bookmarks
- self-profile compatibility
- business contact compatibility
- public core routes

Historical membership use that remains in unrelated profile/contact compatibility is explicitly outside this bounded cleanup and is not treated as resident-economy mutation authority.

## CI contract

`resident-economy-household-v2-contract.mjs` now proves both layers:

1. current Household-v2 mutation handler owns create/resubmit/claim and contains no `complex_memberships` authority;
2. lower legacy handlers/core no longer contain alternate resident-economy mutation entrypoints.

Routing order remains asserted as defense in depth, but correctness no longer depends solely on that ordering.

## Invariants

`BUSINESS_APPLICATION_CREATE -> RESIDENT_ECONOMY_V2_ONLY`

`BUSINESS_APPLICATION_RESUBMIT -> RESIDENT_ECONOMY_V2_ONLY`

`BENEFIT_CLAIM -> RESIDENT_ECONOMY_V2_ONLY`

`LEGACY_COMPLEX_MEMBERSHIP != DORMANT_MUTATION_AUTHORITY`

`ROUTER_ORDER_REGRESSION != LEGACY_AUTHZ_REACTIVATION`

## Hard boundaries

- no frontend/UI change
- no migration/schema change
- no current product mutation behavior change
- no resident-verification provider selection
- Issue #59 remains HOLD
- no production DB/Drive mutation
- no deploy
- no merge

Target verdict:

`LEGACY_RESIDENT_ECONOMY_MUTATION_PATHS_REMOVED`
