# DanjiOn Admin Operational RBAC Policy v1

Date: 2026-08-26
Authority: product-owner operating decision + Issue #76

## Operating principle

Danjion day-to-day operations are carried by **PADIEM + resident council**. The management office is not a default ongoing operator.

Management-office participation, if needed later, is limited to explicit onboarding/support scopes and does not grant business, benefit, official-content, Community, CS, or audit authority.

This is an operational product/RBAC decision. It is not a legal conclusion about personal-data controller/processor status. Privacy Issue #59 remains HOLD.

## Phase-B endpoint policy

| Operation | PADIEM scope | Resident-council scope | Management office default |
| --- | --- | --- | --- |
| Business application list/review | `business.review` | `council.business.review` | DENY |
| Official complex post create/update | `official-content.manage` | `council.official-content.manage` | DENY |
| Benefit create/update | `benefit.manage` | `council.benefit.manage` | DENY |

PADIEM grants are platform-wide and come only from `padiem_operator_grants`.
Resident-council grants are complex-scoped and come only from `complex_operator_grants` with `operator_kind=resident_council`.

Legacy `complex_memberships.role in (manager, admin)` is not an authority source for the migrated routes.
`onboarding_support` grants can never satisfy `council.*` or PADIEM operational scopes.

## Audit

Each migrated operational authorization decision produces one `audit_events` record with action `authorization.operational-check` and the resolved authority kind or denial reason.

## Migration strategy

`admin-operational-v2.ts` intercepts the six migrated route shapes before legacy `admin-v1.ts`. This keeps the change bounded and allows unrelated historical admin route families to be migrated separately without silently changing their behavior.

Remaining admin families, including resident-verification/review-context/audit/storage access, require separate authority review before claiming that all legacy management-office authority has been removed.

## Hard boundaries

- no frontend/UI change
- no production DB migration/write
- no production deploy
- no broad resident PII access
- no resident-verification provider decision
- no management-office default dashboard
