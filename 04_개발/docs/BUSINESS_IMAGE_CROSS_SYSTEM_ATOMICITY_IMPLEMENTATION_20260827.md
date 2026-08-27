# Business Image Cross-System Atomicity Implementation — 2026-08-27

Status: design-independent backend implementation candidate

Refs: #108, #107, #106, #105, #103, #104, #90

Implementation base:

`64663e0774d21e64288e2d49af45c62771a4b674` — PR #107 exact accepted architecture head

## 1. Purpose

Implement the architecture verdict:

```text
BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_DESIGNED
```

with a PostgreSQL-authoritative lifecycle registry and short database critical sections, while keeping Google Drive external I/O outside database transactions.

Target implementation invariant:

```text
NEW_REFERENCE XOR DELETE_INTENT
```

The implementation does not change frontend/UI, resident-verification evidence policy, operator scopes, or the database connection model.

## 2. Registry foundation

Migration 019 introduces:

```text
business_image_objects
```

Lifecycle:

```text
active -> delete_pending -> retired
```

The row is keyed by canonical DanjiOn business-image object key and binds:

- uploader `app_users.id`;
- canonical `complexes.id`;
- lifecycle state;
- created/updated/delete-requested/retired timestamps.

Resident-evidence is deliberately excluded.

## 3. Upload registration

Current business-image upload becomes:

```text
canonical auth
-> Household-v2 verified resident
-> Drive upload
-> insert active business_image_objects row
-> return object key
```

A Drive upload that cannot be registered in PostgreSQL is not returned as a usable product object key. It is only an orphan candidate.

## 4. Application reference acquisition

PR #103 strict Drive validation remains authoritative before database reference acquisition.

For create/resubmit with an image, the implementation uses a short Neon HTTP transaction:

### Statement A

```text
SELECT business_image_objects ... FOR UPDATE
```

by exact object key.

### Statement B

Persist the application reference only when the same registry row is:

- `active`;
- bound to the verified resident uploader;
- bound to the canonical resident complex.

The application write and registry serialization are inside the same database transaction. Google Drive is not called inside that transaction.

Image-less application create/resubmit remains registry-independent.

Completed idempotent application replay remains before external Drive revalidation and new registry reference acquisition.

## 5. Delete intent

For a registered active business image, deletion uses one short two-command Neon HTTP transaction.

### Statement A

Lock the lifecycle row using `FOR UPDATE` and establish the object-level serialization point.

### Statement B

Using the fresh READ COMMITTED command snapshot after Statement A owns the row:

- re-check `business_media.object_key`;
- re-check application references in `draft`, `pending`, `changes_requested`, `approved`;
- preserve `rejected` exclusion from PR #105;
- if referenced, return `BUSINESS_IMAGE_IN_USE` / 409;
- otherwise transition `active -> delete_pending`.

The transaction commits before any Drive trash request.

## 6. External Drive retirement saga

Only a committed `delete_pending` state may initiate/retry Drive retirement.

### Drive success

```text
delete_pending -> retired
```

in a separate short database update.

### Drive failure or ambiguous response

Remain:

```text
delete_pending
```

and fail closed with a controlled 503-class response.

The object is not silently reactivated.

## 7. Retry/reconciliation

`delete_pending` retry does not reuse the strict active-reference validator.

```text
STRICT_ACTIVE_METADATA_VALIDATION != RETIREMENT_RECONCILIATION_PROBE
```

Retry behavior:

- object already Drive-trashed -> finalize `retired`;
- object absent after authoritative delete intent -> finalize `retired`;
- object still live and server metadata matches uploader/folder/kind/visibility -> retry Drive trash;
- Drive unavailable or metadata cannot be reconciled safely -> keep `delete_pending` and fail closed;
- registry already `retired` -> idempotent successful delete response.

## 8. Legacy unregistered compatibility

Pre-registry business-image objects may exist in historical Drive storage.

The bounded compatibility path retains PR #105 semantics:

```text
strict Drive metadata/uploader auth
-> protected product reference check
-> Drive trash only if unreferenced
```

Current application reference acquisition requires an `active` registry row, so an unregistered object cannot acquire a new current product reference while the legacy delete path runs.

Deployment must still re-check production reference counts before migration; any legacy references require explicit backfill audit rather than relying on this delete compatibility path.

## 9. Preserved boundaries

- PR #103 strict uploader/complex Drive validation remains.
- PR #105 protected-reference states remain.
- uploader-only business-image mutation remains.
- no PADIEM/council media-delete scope is created.
- no legacy manager/admin authority is restored.
- resident-evidence upload remains Issue #59 HOLD.
- resident-evidence read/delete remains on its existing uploader/HOLD path.
- no Hyperdrive/session connection model is introduced.
- no frontend/UI source is changed.

## 10. Executable evidence

`business-image-cross-system-atomicity.test.mjs` is registered in backend `npm run check` and verifies:

- migration registry/state contract;
- upload registration before key return;
- create/resubmit Drive validation before registry transaction;
- registry `FOR UPDATE` before conditional application write;
- delete-intent transaction has exactly two commands;
- Statement A row lock;
- Statement B protected-reference checks and `delete_pending` transition;
- referenced image 409 behavior;
- registry outage fail-closed behavior;
- uploader boundary;
- retry separation from strict active metadata validation;
- resident-evidence/business-image routing separation.

The historical PR #103 and PR #105 contracts are retained and currentized rather than replaced.

## 11. Validation gates

Implementation acceptance requires:

1. exact-head GitHub Backend CI GREEN;
2. exact-head Pre-Infra Integration CI GREEN;
3. applicable Live Release Gate GREEN;
4. isolated Neon child migration 019 validation;
5. isolated PostgreSQL concurrency evidence for both orderings:

```text
REFERENCE_FIRST -> DELETE_DENIED
DELETE_INTENT_FIRST -> REFERENCE_DENIED
```

Static source ordering or mocked transaction sequencing alone is not sufficient for the final concurrency verdict.

No production database or Drive mutation is authorized by this document.

## 12. Production rollout guard

Last read-only production evidence before this implementation lane showed zero application/media image references.

This must be queried again immediately before any future migration/deployment.

```text
legacy refs == 0
  -> normal migration/deploy gates may proceed

legacy refs > 0
  -> STOP
  -> Drive-metadata-backed registry backfill audit required
```

Production schema is currently behind the accepted GitHub migration ancestry, so repository acceptance is not a production deployment claim.

## 13. Current implementation verdict

Until exact-head CI and isolated real PostgreSQL concurrency validation close, status is:

```text
BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_IMPLEMENTATION_CANDIDATE
```

The final verdict may only become:

```text
BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_IMPLEMENTED
```

after all required gates pass.

**DRAFT / DO NOT MERGE.**
