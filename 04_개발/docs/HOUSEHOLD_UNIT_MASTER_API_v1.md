# Danjion Household Unit Master API v1

Date: 2026-08-26  
Issue: #54  
Parent visual/product map: `CURRENT_UI_TO_API_DB_MAP_20260826.md`

## Purpose

Provide the current Gate1 dong/unit picker with a real master-data read without granting resident authority from unit selection.

## Endpoint

```text
GET /api/v1/complexes/:complexSlug/household/units
```

Authentication: **required** via canonical `requireActor()`.

Verified-resident authorization: **not required**. This read occurs before Household Verification is completed.

## Response

```json
{
  "data": {
    "complex": {
      "slug": "bangnim-myeongji-roadhill",
      "name": "방림명지로드힐"
    },
    "units": [
      {
        "id": "<complex_unit uuid>",
        "buildingCode": "101",
        "unitCode": "101"
      }
    ]
  },
  "requestId": "..."
}
```

Only active `complex_units` for an active/pilot complex are returned.

## Privacy boundary

The unit picker response does **not** expose:

- household ID
- household membership ID/role/status
- household invite token or token hash
- family invite state
- resident count
- phone/email/provider identity
- operator permission/grant
- legacy `complex_memberships` role/verification state

The endpoint is not public. A common QR/link may bring a user to the product shell, but reading the dong/unit master requires an authenticated account.

## Authority boundary

```text
Authenticated account
  → may read unit master

Unit selected
  ≠ Household verified
  ≠ VERIFIED RESIDENT
```

Resident-only actions continue to require `requireVerifiedResident()` after the later household claim/redeem flow succeeds.

## Data source

Existing forward migration only:

- `009_household_foundation.sql`
  - `complex_units`
  - `households`
  - `household_memberships`

No schema change is introduced by this API.

## Next API

After this read is green, the next P0 lane is household invite `claim/redeem` with an atomic membership transition. Plaintext invite tokens must never be persisted; migration 010 stores token hashes only.

## Non-goals

- production unit-master seed/import
- household invite claim/redeem
- family invitation
- consent API
- Community API
- production deployment
