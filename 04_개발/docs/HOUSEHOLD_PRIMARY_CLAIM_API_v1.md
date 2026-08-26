# Danjion Household Primary Claim API v1

Date: 2026-08-26  
Issue: #56  
Parent: #54 / PR #55

## Purpose

Turn the current Gate1 onboarding sequence into a real resident-verification boundary:

```text
Authenticated account
→ select master dong/unit
→ prove possession of that household's primary-claim invite
→ VERIFIED PRIMARY resident
```

Selecting a dong/unit alone never grants resident authority.

## Endpoint

```text
POST /api/v1/complexes/:complexSlug/household/claim
Content-Type: application/json

{
  "unitId": "<complex_unit uuid>",
  "token": "<opaque invite token>"
}
```

Only `unitId` and `token` are accepted. Client-supplied user/complex/household/role/verified fields have no authority.

## Token privacy

The plaintext invite is accepted only in request memory.

Before DB lookup:

```text
SHA-256(plaintext token) → 64-char lowercase hex digest
```

The DB query receives only the digest. Plaintext token material is never:
- persisted
- logged
- audited
- returned

Audit metadata does not store the digest either.

## Atomic transition

A single PostgreSQL data-modifying CTE performs the successful security-sensitive transition.

The target must satisfy all of:
- requested complex is active/pilot
- token hash matches
- purpose = `primary_claim`
- token status = `active`
- token unexpired and use_count available
- household active
- complex unit active
- token household belongs to requested complex
- token household unit matches selected unitId
- no active/pending PRIMARY already exists for target household
- actor has no active/pending Household membership in the complex

Then the same statement:
1. inserts `household_memberships` as `primary / verified`
2. sets `verified_at=now()`
3. increments invite use_count
4. marks the primary-claim token `redeemed`
5. records the success in `audit_events`

The invite token row is selected `FOR UPDATE` and membership insert uses `ON CONFLICT DO NOTHING`, so concurrent/replay races fail closed without a second active primary or partial token consumption.

## Idempotency

If the authenticated actor is already `verified` for the same selected unit, the endpoint returns the existing verified state without consuming another token.

An existing pending/verified membership elsewhere in the same complex returns `HOUSEHOLD_MEMBERSHIP_EXISTS` and cannot be replaced by a client claim.

## Generic unavailable error

Invalid, expired, already redeemed, wrong-unit, wrong-household, occupied-primary and concurrent/replay failures all collapse to:

```text
409 HOUSEHOLD_CLAIM_UNAVAILABLE
```

This avoids turning the endpoint into a token-existence oracle.

## Response

Success exposes only the onboarding state needed by the resident UI:

```json
{
  "data": {
    "status": "verified",
    "membershipRole": "primary",
    "unitId": "<selected unit uuid>",
    "alreadyVerified": false
  }
}
```

No household ID, token/hash, dong/unit text, resident list or operator data is returned.

## Authorization after success

Resident-only product APIs must derive authority through:

`requireVerifiedResident(request, env, sql, requestId, complexSlug)`

They must not trust the response above as client authority.

## Schema

No new migration. Reuses:
- 009 Household foundation
- 010 Household invite/family lifecycle
- 011 audit_events

## Non-goals

- production invite issuance/seed
- family-member invitation/redeem
- consent API
- Community API
- production deployment
