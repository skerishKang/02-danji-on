# DanjiOn Current Authorization Contract v2

Date: 2026-08-26
Status: C1 STAGED CONTRACT — runtime implementation follows P0 migration lane
Authority: current Product/Operations decisions in Google Drive + Issue #46

## 1. Purpose

Separate three concerns that older DanjiOn code partially mixed:

```text
Account Authentication
!= Resident / Household Authorization
!= PADIEM Platform Operator Authorization
```

Community C2/C3 and every future resident-only feature must depend on these boundaries instead of reading client-supplied role/verified values or treating a complex manager as a PADIEM operator.

## 2. Authentication — reuse existing boundary

Keep the existing `auth-v1.ts` identity path as the current reuse candidate:

```text
Bearer token
→ Neon Auth JWT / JWKS validation
→ auth subject
→ app_users.auth_user_id
→ app actor
```

`app_users` remains the DanjiOn application user projection. Provider-specific Google/Kakao account mechanics belong behind the Auth adapter / Neon Auth layer; Community must not branch on provider.

Do not create a second user system for Community.

## 3. Resident authorization boundary

Canonical runtime interface:

```ts
requireVerifiedResident(request, env, sql, requestId, complexSlug)
  -> { actor, complex, household, membership }
  | controlled Response
```

Required semantics:

1. Resolve authenticated actor from the server-validated auth subject.
2. Resolve target complex from the URL slug, never a trusted client role payload.
3. Require an active household membership for that actor in the target complex.
4. Require the household membership/resident state to be verified and not revoked/expired.
5. Return only the minimum authorization context needed by the caller.
6. A resident of another complex must fail closed.
7. Login success alone must never satisfy this boundary.

The current legacy `complex_memberships.verification_status` may remain readable during migration compatibility, but it is not the long-term household proof authority once v2 household tables are live.

## 4. PADIEM operator boundary

Canonical runtime interface:

```ts
requirePadiemOperator(request, env, sql, requestId, scope)
  -> { actor, operatorGrant }
  | controlled Response
```

Required semantics:

1. Resolve the same authenticated app actor.
2. Look up a separate PADIEM platform operator grant.
3. Check requested scope/action.
4. Never infer PADIEM operator rights from `complex_memberships.role`.
5. Management office / management company status does not automatically create an operator grant.
6. Operator access to resident/household linkage must be audited and purpose-limited.

Initial scope vocabulary should stay small:

```text
community.moderate
resident_verification.review
business_application.review
content.official.manage
```

A wildcard/super-admin scope may exist only for tightly controlled PADIEM administration and must not be the default grant.

## 5. Household model

Minimum P0 entities:

```text
complex_units
households
household_memberships
household_invite_tokens
family_invites
consent_records
audit_events
padiem_operator_grants
```

### `complex_units`

Represents the 192-unit master for the current complex and equivalent unit masters for future complexes.

### `households`

A household container bound to one complex/unit. It is not a public profile.

### `household_memberships`

Links app users to a household with resident relationship/status. Exact dong/unit and household identifiers are private authorization data.

### invite tables

Server-managed, limited-use/expiry tokens. A common public QR must not directly grant verified resident status.

### consent/audit

Consent state and sensitive authorization/operator access events are persisted independently from mutable profile state.

### operator grants

Separate platform authorization. No foreign-key/semantic dependence on complex `manager|admin` role is allowed for platform-operator rights.

## 6. Migration ordering contract

Existing production application migrations `001`–`008` are immutable.

C1 reserves the following **ordering slots**, subject to exact SQL review in their own migration work:

```text
009  household foundation
     - complex_units
     - households
     - household_memberships

010  household invitation/family lifecycle
     - household_invite_tokens
     - family_invites

011  consent + authorization audit
     - consent_records
     - audit_events

012  PADIEM operator authorization
     - padiem_operator_grants

013  earliest Community core slot
     - only if 009–012 land without an additional P0 migration inserted
```

Therefore Community no longer treats its number as an arbitrary `009`. Its earliest current slot is `013`, and C2 must re-check the repository immediately before creating the migration.

This reservation is an ordering contract, not permission to mutate production in C1.

## 7. Community dependency

Community schema may reference `app_users` and `complexes`, but Community API write/read authorization must call the canonical authorization boundaries.

```text
Community read/write
→ requireVerifiedResident(...)

Community moderation
→ requirePadiemOperator(..., 'community.moderate')
```

The old `requireManager()` helper is not an acceptable alias for either function.

## 8. Transition rules for existing APIs

Existing admin/business/resident-verification endpoints may continue using legacy authorization while the P0 migration lane is staged, but they must be inventoried for migration to the new operator boundary.

Do not silently change all current admin endpoints inside Community C1. That is a separate bounded authorization migration because it can affect existing behavior and tests.

## 9. Acceptance tests required before runtime adoption

Synthetic principals:

```text
A = verified resident, complex 1
B = verified resident, complex 1
C = verified resident, complex 2
D = authenticated but unverified
O = PADIEM operator, community.moderate
M = verified complex manager but no PADIEM operator grant
```

Must prove:

- A/B pass resident authorization for complex 1.
- C fails complex 1 authorization.
- D fails resident authorization.
- O passes Community operator authorization with correct scope.
- M does not pass PADIEM operator authorization merely because of complex manager role.
- forged client role/verified/user/complex values do not change the result.
- sensitive operator access emits an audit event where policy requires it.

## 10. C1 disposition

```text
AUTHN_IDENTITY_BOUNDARY = REUSE_EXISTING_AUTH_V1
RESIDENT_AUTHZ_BOUNDARY = STAGED_V2_CONTRACT
PADIEM_OPERATOR_AUTHZ = STAGED_SEPARATE_CONTRACT
LEGACY_COMPLEX_MANAGER_AS_PLATFORM_OPERATOR = REJECT
HOUSEHOLD_MIGRATION_ORDER = RESERVED_009_TO_012
COMMUNITY_EARLIEST_MIGRATION_SLOT = 013_RECHECK_REQUIRED
PRODUCTION_SCHEMA_MUTATION_IN_C1 = NONE
```
