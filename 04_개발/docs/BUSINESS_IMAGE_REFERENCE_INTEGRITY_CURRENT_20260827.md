# Business Image Reference Integrity — CURRENT 2026-08-27

Status: design-independent backend current overlay

Refs: #102, #101, #100, #90

## Problem

A `gdrive/public/business-image/*` object key is intentionally usable for anonymous display. Possession of that public reference is therefore not proof that the current applicant uploaded the image or that the image belongs to the applicant's complex.

Before this overlay, `representativeImageObjectKey` could enter or re-enter a business application and later be copied into `business_media` without binding the reference to the applicant and complex across the full application lifecycle.

## Current invariant

```text
PUBLIC_OBJECT_KEY_POSSESSION != IMAGE_OWNERSHIP

APPLICATION_IMAGE_OWNER == APPLICANT_USER
APPLICATION_IMAGE_COMPLEX == APPLICATION_COMPLEX

APPLICATION_CREATE_VALIDATION + RESUBMIT_VALIDATION + APPROVAL_REVALIDATION
```

## Server-controlled storage authority

Business-image upload already writes Google Drive `appProperties` controlled by the backend:

- `danjionKind=business-image`
- `danjionVisibility=public`
- `danjionUploaderUserId=<canonical app user id>`
- `danjionComplexSlug=<canonical complex slug>`

The same storage layer also verifies the expected business folder, trash state, object-key namespace, kind and visibility.

## Application create boundary

When a new application contains `representativeImageObjectKey`:

1. validate application input;
2. require Household-v2 verified resident for the requested complex;
3. preserve successful idempotent replay semantics before external storage revalidation;
4. for a genuinely new application, read the Drive metadata;
5. require public business-image namespace, expected folder, not-trashed state and matching server-controlled kind/visibility;
6. require uploader user id == verified resident id;
7. require image complex slug == verified resident canonical complex slug;
8. only then insert the application.

Applications without an image do not depend on Google Drive availability.

## Changes-requested resubmit boundary

The current resident-economy mutation handler now intercepts applicant `PATCH /api/v1/me/business-applications/:id` before the legacy application handler.

For a resubmit:

1. authenticate the canonical applicant;
2. resolve the application with an owner-scoped lookup;
3. require the current state to be `changes_requested`;
4. derive the canonical complex from the stored application rather than trusting a client-supplied complex;
5. require current Household-v2 verified-resident authority for that complex;
6. if a replacement representative image is supplied, validate its Drive metadata against the verified resident id and canonical complex slug;
7. only then persist the replacement application fields and return the application to `pending`.

This prevents a foreign public object key from entering the application through the resubmit path after a valid original submission.

## Approval boundary

For `status=approved`:

1. resolve application context;
2. require current PADIEM or resident-council `business.review` authority;
3. preserve already-approved replay without depending on current Drive state;
4. if a representative image is present, re-read and revalidate the image against the stored applicant user id and application complex slug;
5. only after successful revalidation run the approval SQL that materializes `businesses`, `business_complex_relations`, and `business_media`.

This prevents a deleted, moved, replaced-scope or foreign-owned public image reference from being promoted between submission/resubmission and approval.

## Failure behavior

- malformed/non-business namespace -> `INVALID_BUSINESS_IMAGE_REFERENCE` / 400
- missing, trashed, wrong folder, wrong kind or wrong visibility -> `INVALID_BUSINESS_IMAGE_REFERENCE` / 400
- uploader or complex mismatch -> `BUSINESS_IMAGE_REFERENCE_FORBIDDEN` / 403
- storage verification unavailable -> fail closed / 503

## Executable verification

The backend contract uses mocked OAuth/Drive responses only. It performs no live Google Drive write and exercises the validator as a read-only integrity boundary for valid ownership/scope, foreign uploader, foreign complex, trash state, folder mismatch, kind mismatch, and invalid namespace cases.

The contract also fixes lifecycle ordering for:

- create: verified-resident AuthZ -> completed idempotent replay -> image validation -> insert;
- resubmit: canonical actor -> owner/state lookup -> verified-resident AuthZ -> replacement-image validation -> update;
- approval: business-review AuthZ -> already-approved replay -> image revalidation -> materialization.

## Preserved boundaries

- no representative image -> application and approval remain Drive-independent
- public business-image GET remains public-display-only
- business-image upload still requires Household-v2 verified resident
- non-uploader media mutation remains forbidden
- resident-evidence Issue #59 HOLD remains unchanged
- `business.review` / `council.business.review` remains the operational review authority
- no operator media-delete scope is invented
- no DB metadata table or migration is introduced
- resident application GET/read behavior remains on the existing lower handler; only current mutations are intercepted above it

## Out of scope

- referenced-object delete protection (#104)
- orphan-media cleanup
- retention policy
- production Google Drive write
- production DB mutation
- frontend/UI changes
- production deploy
- merge

Required exact-head verdict after CI:

`BUSINESS_IMAGE_REFERENCE_INTEGRITY_ENFORCED`
