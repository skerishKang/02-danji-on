# Business Image Resolved-State Reconciliation Lease Cleanup Architecture

Date: 2026-08-27
Repository: `skerishKang/02-danji-on`
Parent issue: #126
Architecture issue: #127
Accepted predecessor head: `e34df7ed813db0965bb7baaa676cd3fa02754492`

## 1. Problem

Migration 021 introduced finite background reconciliation ownership metadata on `business_image_objects`:

- `reconcile_lease_token`
- `reconcile_lease_expires_at`
- `reconcile_attempt_count`
- `reconcile_next_attempt_at`
- `reconcile_last_error_code`
- `reconcile_last_attempt_at`

These fields are operational metadata for unresolved `upload_pending` and `delete_pending` rows.

Background reconciliation already clears lease ownership/scheduling metadata when its own lease-token CAS resolves a row to `active` or `retired`.

Foreground resolution currently differs:

- `activateBusinessImageUpload()` can resolve `upload_pending -> active` without clearing a concurrently-held background lease or pending retry schedule.
- `finalizeBusinessImageRetired()` can resolve `delete_pending -> retired` without clearing the same pending-only metadata.

A background worker that later attempts token-bound finalization/defer correctly becomes stale, but the resolved row can retain reconciliation metadata that semantically belongs only to pending work.

## 2. Non-problem: resume versus delete

The current state machine already prevents direct delete intent from racing ahead of a request-side upload resume while the row remains `upload_pending`.

`acquireBusinessImageDeleteIntent()` acquires delete intent only from `active`.

Therefore this architecture does not introduce an upload/delete lock spanning Google Drive I/O and does not add a new lifecycle state for that purpose.

## 3. Authority

PostgreSQL remains the lifecycle serialization authority.

Google Drive remains the binary/object store.

No PostgreSQL transaction or row lock is held across Google Drive network I/O.

The reconciliation lease is server-owned operational metadata, not user authority and not object ownership.

## 4. Resolved-state invariant

A resolved object must not retain pending reconciliation ownership or a future retry schedule.

Required invariant:

```text
ACTIVE | RETIRED
-> reconcile_lease_token IS NULL
-> reconcile_lease_expires_at IS NULL
-> reconcile_next_attempt_at IS NULL
-> reconcile_last_error_code IS NULL
```

Historical counters are intentionally retained:

```text
reconcile_attempt_count MAY REMAIN > 0
reconcile_last_attempt_at MAY REMAIN NON-NULL
```

They are operational history, not live ownership.

## 5. Foreground resolution contract

Every successful foreground transition into a resolved state must clear the pending-only reconciliation metadata in the same SQL statement that changes lifecycle state.

### 5.1 Upload activation

`upload_pending -> active` must atomically:

- set `state='active'`
- clear `reconcile_lease_token`
- clear `reconcile_lease_expires_at`
- clear `reconcile_next_attempt_at`
- clear `reconcile_last_error_code`
- update `updated_at`

If a background worker previously owned a lease, that lease becomes invalid immediately. Any later background finalize/defer requiring its token must return stale/no-row.

### 5.2 Retirement finalization

`delete_pending -> retired` must atomically:

- set `state='retired'`
- set/retain `retired_at`
- clear `reconcile_lease_token`
- clear `reconcile_lease_expires_at`
- clear `reconcile_next_attempt_at`
- clear `reconcile_last_error_code`
- update `updated_at`

A later background token operation must become stale/no-row.

## 6. Migration 023

A small migration is appropriate because the invariant belongs to durable registry state, not only to one runtime caller.

Migration 023 should:

1. backfill any existing `active` / `retired` row by clearing:
   - `reconcile_lease_token`
   - `reconcile_lease_expires_at`
   - `reconcile_next_attempt_at`
   - `reconcile_last_error_code`
2. preserve:
   - `reconcile_attempt_count`
   - `reconcile_last_attempt_at`
3. add a resolved-state check constraint requiring pending-only reconciliation ownership/scheduling fields to be null whenever state is `active` or `retired`.

Recommended logical constraint:

```sql
check (
  state in ('upload_pending', 'delete_pending')
  or (
    reconcile_lease_token is null
    and reconcile_lease_expires_at is null
    and reconcile_next_attempt_at is null
    and reconcile_last_error_code is null
  )
)
```

The existing lease-pair constraint remains authoritative for token/expiry pairing.

## 7. Background compatibility

No behavioral redesign of `storage-reconciliation-v1.ts` is required.

Its existing background finalizers already clear the same live lease/scheduling fields.

Foreground resolution may invalidate a live background claim. This is intentional:

```text
FOREGROUND_RESOLUTION_FIRST
-> BACKGROUND_TOKEN_CAS = STALE
```

Conversely, if the background finalizer resolves first, the foreground resolver must continue to accept the already-resolved state according to its existing idempotent/state reconciliation behavior.

## 8. Required concurrency tests

PostgreSQL 18 gate must include real transaction ordering for at least:

### A. Foreground activation while background lease is live

1. row is `upload_pending`
2. background claim sets live lease token
3. foreground activation resolves to `active` and clears live metadata
4. background token-bound defer/finalize affects zero rows
5. active row retains historical attempt metadata only

Expected:

```text
FOREGROUND_ACTIVE_FIRST -> LEASE_CLEARED -> BACKGROUND_STALE
```

### B. Foreground retirement while background lease is live

1. row is `delete_pending`
2. background claim owns lease
3. foreground retirement resolves to `retired` and clears live metadata
4. background token-bound operation affects zero rows

Expected:

```text
FOREGROUND_RETIRED_FIRST -> LEASE_CLEARED -> BACKGROUND_STALE
```

### C. Constraint failure

Direct attempts to persist `active` or `retired` with non-null live lease/scheduling metadata must fail closed.

### D. Pending compatibility

`upload_pending` / `delete_pending` rows continue to allow valid finite leases and retry schedules.

## 9. Runtime contract tests

Static/runtime contract should confirm:

- upload activation clears pending-only reconciliation metadata
- synchronous retirement finalization clears the same metadata
- historical attempt fields are not erased
- existing background finalizers remain unchanged or semantically equivalent
- no new Drive calls or broad list operations are introduced
- no frontend/UI changes

## 10. Scope exclusions

This lane does not:

- change upload idempotency semantics
- change same-ID resume semantics
- change delete authorization
- add operator/human media authority
- process resident evidence
- change Issue #59 HOLD
- change UI/UX
- deploy migrations to production
- deploy Cron/Worker changes
- merge any PR

## 11. Acceptance verdict

Architecture is acceptable when the exact docs-only head is reviewed with no file collision and secret scan passes.

Target verdict:

`BUSINESS_IMAGE_RESOLVED_LEASE_CLEANUP_ARCHITECTURE_ACCEPTED`

Implementation must be a separate stacked Draft PR.
