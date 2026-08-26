# DanjiOn admin review/privacy RBAC v1

## Product decision

Day-to-day DanjiOn operations are handled by PADIEM + the resident council. The management office is not a default ongoing operator and may only receive narrowly scoped onboarding/support authority when explicitly granted.

## Business application review

The following read surfaces use the same explicit operational authority as business application review itself:

- application review history
- application review context

Allowed authority:

- PADIEM `business.review`
- resident council `council.business.review`, scoped to one apartment complex

Not authority:

- legacy `complex_memberships manager/admin`
- management-office `onboarding_support`
- client-supplied role/verified/complex headers

Review context is intentionally minimized. It may expose public application fields plus a small review basis (display name, relation type, aggregate verification status/count), but it must not expose resident evidence object keys, auth provider identifiers, email, phone, building/unit coordinates, or other resident evidence payloads.

## Resident verification administration

Issue #59 remains a hard privacy/product-policy gate. Until the resident-verification provider and legal/data-access basis are explicitly approved, admin resident-verification list/review routes fail closed with `RESIDENT_VERIFICATION_POLICY_HOLD`.

No management-office, PADIEM, or resident-council role receives resident verification evidence merely because it has an operational role.

## Deployment boundary

This change is code-only. It does not apply a production database migration, import a resident roster, configure a verification provider, or deploy production infrastructure.
