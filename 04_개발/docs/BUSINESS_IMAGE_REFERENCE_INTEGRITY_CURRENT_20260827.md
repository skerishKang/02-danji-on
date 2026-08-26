# Business Image Reference Integrity — CURRENT 2026-08-27

Status: design-independent backend current overlay

Refs: #102, #101, #100, #90

## Problem

A `gdrive/public/business-image/*` object key is intentionally usable for anonymous display. Possession of that public reference is therefore not proof that the current applicant uploaded the image or that the image belongs to the applicant's complex.

Before this overlay, `representativeImageObjectKey` could be stored on a business application and later copied into `business_media` without binding the reference to the applicant and complex at the application/approval boundaries.

## Current invariant

```text
PUBLIC_OBJECT_KEY_POSSESSION != IMAGE_OWNERSHIP

APPLICATION_IMAGE_OWNER == APPLICANT_USER
APPLICATION_IMAGE_COMPLEX == APPLICATION_COMPLEX

APPLICATION_CREATE_VALIDATION + APPROVAL_REVALIDATION
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

## Approval boundary

For `status=approved`:

1. resolve application context;
2. require current PADIEM or resident-council `business.review` authority;
3. preserve already-approved replay without depending on current Drive state;
4. if a representative image is present, re-read and revalidate the image against the stored applicant user id and application complex slug;
5. only after successful revalidation run the approval SQL that materializes `businesses`, `business_complex_relations`, and `business_media`.

This prevents a deleted, moved, replaced-scope or foreign-owned public image reference from being promoted between submission and approval.

## Failure behavior

- malformed/non-business namespace -> `INVALID_BUSINESS_IMAGE_REFERENCE` / 400
- missing, trashed, wrong folder, wrong kind or wrong visibility -> `INVALID_BUSINESS_IMAGE_REFERENCE` / 400
- uploader or complex mismatch -> `BUSINESS_IMAGE_REFERENCE_FORBIDDEN` / 403
- storage verification unavailable -> fail closed / 503

## Executable verification

The backend contract uses mocked OAuth/Drive responses only. It performs no live Google Drive write and exercises the validator as a read-only integrity boundary for valid ownership/scope, foreign uploader, foreign complex, trash state, folder mismatch, kind mismatch, and invalid namespace cases.

## Preserved boundaries

- no representative image -> application and approval remain Drive-independent
- public business-image GET remains public-display-only
- business-image upload still requires Household-v2 verified resident
- non-uploader media mutation remains forbidden
- resident-evidence Issue #59 HOLD remains unchanged
- `business.review` / `council.business.review` remains the operational review authority
- no operator media-delete scope is invented
- no DB metadata table or migration is introduced

## Out of scope

- orphan-media cleanup
- retention policy
- production Google Drive write
- production DB mutation
- frontend/UI changes
- production deploy
- merge

Required exact-head verdict after CI:

`BUSINESS_IMAGE_REFERENCE_INTEGRITY_ENFORCED`
