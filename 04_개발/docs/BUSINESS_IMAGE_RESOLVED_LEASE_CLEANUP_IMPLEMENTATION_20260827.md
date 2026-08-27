# Business Image Resolved-State Reconciliation Lease Cleanup — Implementation

Date: 2026-08-27
Repository: `skerishKang/02-danji-on`
Issue: #129
Parent: #126
Architecture: #127 / PR #128
Accepted architecture head: `87554f4bee1e83bb05f4086e705294585d919735`

## Implemented boundary

This lane removes pending-only reconciliation ownership/scheduling metadata whenever the durable business-image lifecycle becomes resolved.

Resolved invariant:

```text
ACTIVE | RETIRED
-> reconcile_lease_token IS NULL
-> reconcile_lease_expires_at IS NULL
-> reconcile_next_attempt_at IS NULL
-> reconcile_last_error_code IS NULL
```

Historical operations data is preserved:

```text
reconcile_attempt_count = retained
reconcile_last_attempt_at = retained
```

## Migration 023

`023_business_image_resolved_reconciliation_cleanup.sql`:

- backfills existing `active` / `retired` rows that retain live reconciliation metadata
- leaves attempt history intact
- adds `chk_business_image_resolved_reconciliation_clear`
- keeps valid lease/retry metadata available for `upload_pending` / `delete_pending`

## Foreground activation

`activateBusinessImageUpload()` now resolves `upload_pending -> active` while atomically clearing:

- lease token
- lease expiry
- next retry time
- current reconciliation error code

A background worker that previously claimed the row subsequently loses its token-bound state predicate and becomes stale.

## Foreground retirement

`finalizeBusinessImageRetired()` performs the same cleanup on `delete_pending -> retired`.

The existing already-retired idempotent fallback is unchanged.

## Background compatibility

`storage-reconciliation-v1.ts` is intentionally unchanged. Its own token-bound finalizers already clear the same live metadata.

No transaction or lock is held across Google Drive I/O.

## PostgreSQL 18 acceptance probe

The new probe validates:

- migration 023 backfill for stale `active` and `retired` rows
- history retention
- pending lease/retry compatibility
- foreground activation invalidates a prior background token
- foreground retirement invalidates a prior background token
- direct persistence of live reconciliation metadata on resolved rows fails closed
- final resolved registry contains no pending-only live metadata

## Static/runtime contract

The existing background reconciliation contract now also asserts:

- migration 023 backfill and constraint are present
- foreground activation clears the four live fields
- foreground retirement clears the four live fields
- attempt history is not erased

## Explicit non-gap

No new upload-resume/delete serialization state is introduced. Delete intent can only be acquired from `active`; exact-ID upload resume occurs while the row remains `upload_pending`.

## Hard boundaries preserved

- backend lifecycle only
- no frontend/UI source change
- no resident-evidence workflow change; Issue #59 remains HOLD
- no new human/operator media authority
- no production database mutation during acceptance
- no production Google Drive mutation
- no deploy
- no merge

Target acceptance verdict:

`BUSINESS_IMAGE_RESOLVED_LEASE_CLEANUP_IMPLEMENTED`

DRAFT / DO NOT MERGE.
