# Business Image Reference Delete Guard — CURRENT 2026-08-27

Status: design-independent backend current overlay

Refs: #104, #103, #102, #101, #100, #90

## Problem

DanjiOn stores Google Drive business-image object keys as product references in PostgreSQL:

- `business_applications.representative_image_object_key`
- `business_media.object_key`

The storage object is intentionally public-readable, while mutation remains uploader-only. Uploader ownership by itself, however, does not mean the object is safe to delete. Before this overlay, the uploader could trash an image that was already referenced by a pending/reviewed application or an already materialized business-media row, leaving a broken product reference.

## Current invariant

```text
UPLOADER_OWNS_OBJECT != OBJECT_SAFE_TO_DELETE

EXISTING_REFERENCED_BUSINESS_IMAGE -> DELETE_DENY

PRODUCT_REFERENCE_CHECK -> BEFORE_DRIVE_TRASH
```

## Delete authorization ordering

`DELETE /api/v1/storage/objects?objectKey=...` preserves the existing storage authority order:

1. require canonical authenticated product actor;
2. parse and validate the DanjiOn object key;
3. read Google Drive metadata and verify expected folder/kind/visibility/not-trashed state;
4. require uploader mutation authority through the existing `authorizeObject()` boundary;
5. only for `business-image`, query current product references by exact object key;
6. if already referenced, return `BUSINESS_IMAGE_IN_USE` / HTTP 409;
7. only an unreferenced image reaches the Google Drive `trashed: true` PATCH.

The product-reference query is deliberately after object/uploader authorization so it does not disclose application/business reference state to an unauthorized caller.

## Protected existing references

### Materialized business media

Any matching row in:

```text
business_media.object_key
```

blocks deletion regardless of the current business status. The storage layer must not break a persisted product-media relationship.

### Business application lifecycle

A matching `business_applications.representative_image_object_key` blocks deletion when application status is one of:

- `draft`
- `pending`
- `changes_requested`
- `approved`

These states are still part of the active/current application lifecycle or can be materialized into business records.

`rejected` is intentionally excluded. Treating rejected applications as an indefinite storage-retention rule would introduce a new retention policy that has not been approved.

## Fail-closed database behavior

If the PostgreSQL reference query cannot complete, deletion fails closed:

```text
BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE -> HTTP 503
```

No Drive trash mutation occurs when existing-reference safety cannot be established.

## Error contract

- referenced by `business_media` -> `BUSINESS_IMAGE_IN_USE` / 409
- referenced by active/current application state -> `BUSINESS_IMAGE_IN_USE` / 409
- reference database query unavailable -> `BUSINESS_IMAGE_REFERENCE_CHECK_UNAVAILABLE` / 503
- unreferenced and uploader-authorized -> existing Drive trash path remains allowed

## Cross-system atomicity boundary

This overlay protects references that already exist in PostgreSQL at delete-check time. It does **not** claim full atomicity across Google Drive and PostgreSQL.

A separate TOCTOU race remains possible because application create/resubmit performs external Drive validation before its PostgreSQL write, while delete performs a PostgreSQL reference check before its external Drive trash mutation. Without a coordinated storage-object state/locking protocol, those multi-system operations are not one atomic transaction.

Therefore:

```text
REFERENCE_CHECK_PASS != CROSS_SYSTEM_ATOMICITY

VALIDATE_THEN_INSERT + CHECK_THEN_TRASH -> TOCTOU_RISK
```

Closing that race requires a separate architecture decision and must not be silently folded into this bounded delete-guard repair.

## Preserved boundaries

- business-image mutation remains uploader-only;
- public business-image GET remains unchanged;
- no PADIEM or resident-council media-delete scope is invented;
- historical `complex_memberships manager/admin` remains non-authoritative;
- resident-evidence Issue #59 HOLD remains unchanged;
- resident-evidence uploader self-delete does not enter the business-product reference query;
- no DB migration or storage-reference table is introduced;
- no permanent Google Drive deletion is introduced.

## Executable contract

`business-image-reference-delete-guard.test.mjs` verifies:

- unreferenced image -> no conflict;
- `business_media` reference -> 409;
- active/current application reference -> 409;
- DB outage -> 503 fail closed;
- application state set is exactly `draft/pending/changes_requested/approved`, excluding `rejected`;
- object/uploader authorization precedes the product-reference check;
- product-reference check precedes Google Drive trash mutation;
- the reference guard runs only for `business-image`;
- resident-evidence self-delete stays outside this business-reference policy.

The test is part of backend `npm run check`.

## Out of scope

- cross-system create/resubmit/delete atomicity;
- retention duration policy;
- rejected-application retention;
- orphan-media garbage collection;
- operator/media moderation delete authority;
- permanent Drive deletion;
- frontend/UI changes;
- production DB mutation;
- production Google Drive write;
- production deploy;
- merge.

Required exact-head verdict after CI:

`BUSINESS_IMAGE_EXISTING_REFERENCE_DELETE_GUARD_ENFORCED`
