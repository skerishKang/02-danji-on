# Business Media Storage Authorization — 2026-08-27

Status: **CURRENT / DESIGN-INDEPENDENT BACKEND AUTHZ**

Related: Issue #100, PR #99 ancestry, resident-economy Household v2

## Purpose

Business representative images are uploaded before a resident submits a business application. The application mutation already uses the current Household-v2 verified-resident boundary. Storage must use the same resident authority rather than historical `complex_memberships` rows.

The same currentization removes the remaining historical `manager|admin` fallback from non-uploader business-image mutation. Public display does not imply public or legacy-manager mutation authority.

## Current invariants

```text
BUSINESS_APPLICATION_CREATE_AUTHZ == HOUSEHOLD_V2_VERIFIED_RESIDENT

BUSINESS_IMAGE_UPLOAD_AUTHZ == HOUSEHOLD_V2_VERIFIED_RESIDENT

LEGACY_COMPLEX_MEMBERSHIP != BUSINESS_MEDIA_STORAGE_AUTHORITY

LEGACY_MANAGER_ADMIN != BUSINESS_MEDIA_DELETE_AUTHORITY

PUBLIC_MEDIA_READ != PUBLIC_MEDIA_MUTATION
```

## Business-image upload

`POST /api/v1/storage/objects` with `kind=business-image`:

1. requires canonical DanjiOn account authentication;
2. validates the storage payload;
3. requires current `requireVerifiedResident()` for the supplied complex slug;
4. only then calls the Google Drive upload helper;
5. records the verified resident's internal `app_users.id` and canonical complex slug in server-controlled Drive `appProperties`.

A historical `complex_memberships` row, role, or verification flag is not consulted as storage upload authority.

This matches the resident-economy business-application create mutation, which independently requires the same Household-v2 verified-resident authority. Passing the storage upload gate does not bypass the application mutation's own authorization.

## Business-image read

`GET /api/v1/storage/public?objectKey=...` remains an anonymous public proxy for valid `gdrive/public/business-image/*` objects after folder and server-controlled metadata checks.

Public readability is display behavior only. It does not grant delete or other mutation rights.

## Business-image delete

`DELETE /api/v1/storage/objects?objectKey=...`:

- uploader self -> allowed under the existing authenticated object boundary;
- any non-uploader -> HTTP 403 `FORBIDDEN`.

No historical apartment `manager|admin` role grants delete authority.

The existing operational `business.review` / `council.business.review` scopes remain application-review scopes. This repair does not silently reinterpret them as arbitrary Google Drive media-delete scopes. A future operator media-moderation capability requires a separately explicit scope and lifecycle design.

## Resident-evidence preservation

This currentization does not weaken the resident-verification privacy HOLD:

- new `resident-evidence` upload remains HTTP 503 `RESIDENT_VERIFICATION_POLICY_HOLD`;
- historical evidence uploader self read/delete remains available;
- every non-uploader resident-evidence read/delete remains policy-HOLD.

## Explicit non-decisions

This lane does not decide or implement:

- operator media moderation/delete scopes;
- orphan media garbage collection;
- image retention periods;
- linking/ownership validation of an arbitrary application object key against Drive metadata;
- production Drive smoke/write;
- production DB mutation or migration;
- frontend/UI behavior.

## Required acceptance

```text
BUSINESS_IMAGE:
CANONICAL_ACCOUNT_AUTH
  -> STORAGE_VALIDATION
  -> HOUSEHOLD_V2_VERIFIED_RESIDENT
  -> DRIVE_UPLOAD

NON_UPLOADER_BUSINESS_IMAGE_DELETE
  -> FORBIDDEN

STORAGE_RUNTIME
  -> NO complex_memberships AUTHORITY
```

Final verdict when exact-head gates are green:

`BUSINESS_MEDIA_STORAGE_CURRENT_AUTHZ_ENFORCED`
