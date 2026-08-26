# COMMUNITY C6A BACKEND SECURITY ACCEPTANCE

Date: 2026-08-26
Parent: Issue #71 / Community umbrella #45
Base: C4 exact green head `86bf7c11a378f74e72e0ce62f3a3b6ead913efcb`

## Scope

Backend-only security acceptance while sibling-design C5 UI integration remains deferred.

No frontend/UI changes are part of this gate.

## CI security gate

`tests/community-c6a-security-gate.mjs` is included in backend `npm run check` and composes the existing executable authorization-principal test with C3/C4/schema source contracts.

Synthetic principals remain:

- A / B: verified residents in complex 1
- C: verified resident in complex 2
- D: authenticated but unverified
- O: explicit PADIEM `community.moderate` operator
- M: apartment manager/resident without PADIEM operator grant

The gate protects:

- Household-v2 verified-resident authorization
- cross-complex tenant isolation
- server-side ownership checks
- idempotent reactions
- repeated-open-report uniqueness
- explicit PADIEM operator scope
- moderation state-only behavior
- atomic moderation event coupling
- nickname-only Community projections
- resident Community separation from public `complex_posts`

## Isolated Neon SQL acceptance

Project: Danjion (`old-shape-61609481`)

Temporary child branch:

- name: `tmp-community-c6a-security-20260826`
- id: `br-divine-base-azzdajos`
- parent: production `br-bold-sun-azurylwi`

The first attempt to submit several migration commands inside one prepared statement was rejected by Neon before execution. A verification query confirmed that neither `complex_units` nor `community_posts` had been created. The commands were then submitted as discrete statements on the same temporary branch.

Staged on the temporary branch only:

- Household v2 core from migration 009
- invite/family tables from 010
- consent/audit tables from 011
- PADIEM operator grant table from 012
- resident Community core from 013

Synthetic evidence:

- A/B verified in complex 1: `2`
- C verified in complex 2: `1`
- D verified memberships: `0`
- O active `community.moderate` grants: `1`
- M active PADIEM grants: `0`
- M legacy apartment-manager memberships: `1`
- duplicate reaction attempts produced exactly one reaction row
- duplicate open report was rejected by `uq_community_open_post_report_per_user`
- cross-complex comment targeting a complex-1 post with complex-2 scope was rejected by the composite post/complex foreign key
- operator hide transition produced a moderation event in the same data-modifying CTE
- operator restore transition produced a moderation event in the same data-modifying CTE
- report resolution produced a `report_resolved` moderation event in the same data-modifying CTE
- final synthetic post status: `published`
- final synthetic report status: `resolved`

The temporary branch was deleted after acceptance.

## Production safety

A read-only production check after the sandbox run returned:

- `complex_units`: absent
- `community_posts`: absent
- `padiem_operator_grants`: absent

Therefore no migration 009-013 change was applied to production.

No production data write, production schema migration, or production deploy was performed.

## Verdict boundary

This document supports `COMMUNITY_C6A_BACKEND_SECURITY_READY` only after the exact PR head passes applicable GitHub CI.

It does not claim C5 final UI integration or full browser release acceptance.
