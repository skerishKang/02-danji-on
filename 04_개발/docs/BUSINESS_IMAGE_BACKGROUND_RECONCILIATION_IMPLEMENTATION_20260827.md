# BUSINESS IMAGE BACKGROUND RECONCILIATION IMPLEMENTATION — 2026-08-27

Issue: #116
Architecture: Issue #114 / PR #115

Accepted architecture head:

`3c88e7f02c77ee24771ba18136dda8241c06b6e3`

## Runtime

The HTTP application remains unchanged. `src/worker-v2.ts` delegates HTTP requests to the existing `app.fetch` and adds only a Cloudflare Scheduled Handler.

Production Cron candidate:

`*/15 * * * *`

The scheduled lane calls `runBusinessImageLifecycleReconciliation(env)` and never constructs a resident, PADIEM, council, management-office, or other human principal.

## Database lifecycle

Migration 021 adds reconciliation-only metadata to `business_image_objects`:

- finite lease token + expiry
- attempt count
- next-attempt timestamp
- last bounded error code
- last-attempt timestamp

The product lifecycle remains:

`upload_pending -> active -> delete_pending -> retired`

Reconciliation metadata does not add a new product state.

## Claim protocol

A scheduled run atomically claims at most 25 stale pending rows using:

- `state in ('upload_pending', 'delete_pending')`
- due retry timestamp
- absent/expired lease
- `FOR UPDATE SKIP LOCKED`
- five-minute lease

The claim statement commits before any Google Drive request. No row lock is held across Drive I/O.

## Exact-ID reconciliation

Only the Drive file ID encoded in the canonical object key is queried. No Drive list scan is used.

For `upload_pending`:

- exact live metadata matching folder/kind/visibility/uploader/complex -> conditional `active`
- 404 -> remain pending with backoff
- mismatch -> remain pending, no Drive mutation
- Drive outage -> remain pending with backoff

For `delete_pending`:

- 404 -> conditional `retired`
- already trashed exact matching object -> conditional `retired`
- live exact matching object -> trash exact ID, re-read confirmation, conditional `retired`
- metadata mismatch -> no trash, remain pending
- Drive outage -> remain pending with backoff

All finalization requires the expected lifecycle state and exact lease token. A stale worker cannot overwrite a newer lease result.

## Retry

Backoff schedule is bounded:

- attempt 1: 1 minute
- attempt 2: 5 minutes
- attempt 3: 15 minutes
- attempt 4: 1 hour
- attempt 5+: 6 hours maximum

Attempt exhaustion never implies deletion or retirement.

## Tests

`business-image-background-reconciliation.test.mjs` covers:

- production-only Cron config
- existing HTTP fetch delegation
- migration lease schema
- bounded pending-only claim construction
- backoff cap
- upload activation
- upload 404/mismatch deferral
- delete trash/404/already-trashed retirement
- delete metadata mismatch no-mutation
- Drive outage deferral
- stale lease finalize denial

`business-image-postgres-concurrency.sh` additionally applies migrations 019/020/021 on real PostgreSQL and covers:

- pending-only claim
- active row exclusion
- live lease overlap exclusion
- stale token finalize denial
- correct token finalize
- expired lease reclaim
- attempt increment
- lease-pair constraint
- prior reference-vs-delete race cases

## Boundaries

- no frontend/UI changes
- no resident-evidence processing; Issue #59 remains HOLD
- no new human/operator media authority
- no broad Drive scan
- no production DB/Drive write during acceptance
- no production deploy
- no merge

Candidate verdict until exact-head CI/isolated DB acceptance completes:

`BUSINESS_IMAGE_BACKGROUND_RECONCILIATION_IMPLEMENTATION_CANDIDATE`

**DRAFT / DO NOT MERGE.**
