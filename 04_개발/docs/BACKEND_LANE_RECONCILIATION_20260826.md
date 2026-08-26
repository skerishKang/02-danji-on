# DanjiOn backend lane reconciliation — 2026-08-26

## Why this exists

Several design-independent backend lanes were completed on parallel Draft PR stacks. The current Auth/RBAC/Household head did not automatically inherit all of those runtime files even though Community schema 013 remained present.

This reconciliation layer restores the proven runtime pieces before further backend feature work continues.

## Reconciled lanes

- Community C3 resident API from PR #65
- Community C4 moderation runtime from PR #70
- Community C6A backend security gate from PR #72
- Household-v2 resident economy interception from PR #75
- current Auth / email recovery / Better Auth deletion boundary through PR #89
- current PADIEM + resident-council RBAC through PR #83/#85 ancestry

## Current governance override

Community moderation is currentized from the older PADIEM-only implementation to the latest operational model:

- PADIEM: `community.moderate`
- resident council: `council.community.moderate`
- management-office/onboarding support: no moderation authority
- legacy `complex_memberships manager/admin`: never authority

## Routing order

Sensitive Household-v2 resident-economy POST mutations run before legacy wallet/application handlers. Legacy handlers remain only for ownership/read/use surfaces not migrated by PR #75.

Community resident routes use `requireVerifiedResident(...)` and Community operator routes use `requireOperationalAuthority(...)`.

## Hard boundaries

- no frontend/UI changes
- no production migration/write
- no production deploy
- no resident-verification provider decision
- no management-office default operational role

## Invariants

`ACCOUNT_AUTHENTICATED != VERIFIED_RESIDENT`

`LEGACY_MANAGER_ADMIN != OPERATIONAL_AUTHORITY`

`COMMUNITY_RESIDENT_WRITE -> VERIFIED_HOUSEHOLD_RESIDENT`

`COMMUNITY_MODERATION -> PADIEM_OR_RESIDENT_COUNCIL_EXPLICIT_SCOPE`
