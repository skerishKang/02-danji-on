# Business Image Background Reconciliation Architecture

Date: 2026-08-27
Status: ARCHITECTURE CANDIDATE
Issue: #114
Base: PR #113 exact accepted head `4b8ddeb8b48e877fefd5cbda558a9be2d2aaa3a1`

## 1. Problem

PR #113 makes cross-system ambiguity durable:

- upload ambiguity -> `upload_pending`
- retirement ambiguity -> `delete_pending`

That is safe, but recovery is currently request-scoped. If the caller disappears after the durable state is written, the row can remain pending indefinitely.

Therefore:

`DURABLE_PENDING != AUTONOMOUS_RECOVERY`

The next boundary is a server-owned background reconciler that is independent of UI and human/operator permissions.

## 2. Cloudflare execution model

Use the existing Worker with a module `scheduled(controller, env, ctx)` handler and a Wrangler Cron Trigger.

Official current Cloudflare Workers documentation:

- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- https://developers.cloudflare.com/workers/wrangler/configuration/

Cron Trigger configuration is environment-specific. The first implementation should configure the trigger only under the `production` Wrangler environment and explicitly keep preview without a Cron Trigger.

Candidate cadence:

`*/15 * * * *`

Cloudflare evaluates Cron expressions in UTC. Because this is an interval schedule, local timezone conversion is irrelevant.

The cadence is a product-operational default, not a correctness invariant. Correctness must survive delayed, duplicate or overlapping scheduled executions.

## 3. No long DB lock across Google Drive

Google Drive network I/O must never run while a PostgreSQL row lock or transaction is held.

Use a durable short lease instead:

`SHORT_DB_CLAIM -> COMMIT -> DRIVE_RECONCILIATION -> CONDITIONAL_FINALIZE`

Invariant:

`DB_TRANSACTION_DURATION != DRIVE_NETWORK_DURATION`

## 4. Registry lease direction

A later migration (expected next number 021, subject to fresh verification) should add background-reconciliation metadata to `business_image_objects` rather than create a second lifecycle authority.

Recommended columns:

- `reconcile_lease_token`
- `reconcile_lease_until`
- `reconcile_after`
- `reconcile_attempt_count`
- optional bounded `reconcile_last_error_code`

Do not store raw Google responses or resident PII in the registry.

Lifecycle state remains authoritative:

`upload_pending -> active -> delete_pending -> retired`

Lease metadata never becomes a fifth lifecycle state.

## 5. Claim algorithm

One scheduled run claims only a bounded batch, initially no more than 25 rows.

Eligible states:

- `upload_pending`
- `delete_pending`

Never claim:

- `active`
- `retired`

Eligibility also requires:

- row older than a short safety age, initially 2 minutes
- `reconcile_after <= now()` or null
- no unexpired reconciliation lease

Claim must be atomic and concurrency-safe, using a short transaction/statement with row locking such as `FOR UPDATE SKIP LOCKED`, then writing a fresh server-generated lease token and finite lease expiration.

The transaction commits before any Drive call.

Overlapping Cron runs therefore select disjoint work where possible, and an expired lease makes crashed work recoverable.

## 6. Lease lifetime

Initial lease target: 5 minutes.

The exact value may be tuned, but it must be:

- longer than one normal exact-ID Drive reconciliation attempt
- much shorter than the Cron's maximum execution lifetime
- finite, so Worker termination never permanently strands a row

Finalization must require both:

- expected lifecycle state
- exact lease token

This prevents an old worker from overwriting a newer reconciliation result after its lease expired.

## 7. `upload_pending` reconciliation

For each claimed `upload_pending` row:

1. derive/validate exact Drive file ID from the registered object key
2. obtain canonical complex slug from DB using the registry `complex_id`
3. exact `files.get(fileId)` only
4. validate existing PR #113 metadata boundary:
   - exact ID
   - expected business-image folder
   - not trashed
   - `danjionKind=business-image`
   - `danjionVisibility=public`
   - exact uploader id
   - exact complex slug

Outcomes:

### Valid matching object

Conditionally finalize:

`upload_pending -> active`

Clear lease/retry error metadata.

### Drive unavailable / ambiguous

Keep `upload_pending`.

Release or let the lease expire safely and set a bounded future `reconcile_after`.

### Exact 404 / absent

The first implementation must **not** automatically retire or delete the registry row merely from a missing upload object.

Reason: PR #113 intentionally left authoritative absence conservative after ambiguous create outcomes. Background scheduling does not create new authority to destroy state.

Keep `upload_pending` with backoff.

### Metadata mismatch

Keep `upload_pending` fail-closed with a bounded non-sensitive error code and longer backoff.

Do not move the file, relabel it, activate it, or trash it.

Invariant:

`UPLOAD_PENDING_MISMATCH -> NO_ACTIVATE_AND_NO_DELETE`

## 8. `delete_pending` reconciliation

`delete_pending` already means authoritative delete intent committed under PR #109. No new human authorization is needed for the server to finish that existing lifecycle intent.

For each claimed row:

1. exact Drive file ID only
2. canonical uploader/complex metadata verification when a live object exists
3. reconcile exact current Drive state

Outcomes:

### Exact object absent

Conditionally finalize:

`delete_pending -> retired`

with `retired_at` set.

### Exact object already trashed

Conditionally finalize `retired`.

### Matching live object exists

Trash the exact file, then reconcile the result.

- confirmed trashed/absent -> finalize `retired`
- ambiguous result -> keep `delete_pending` with retry/backoff

### Metadata mismatch

Do not trash.

Keep `delete_pending` fail-closed and record only a bounded error code.

Invariant:

`DELETE_PENDING_MATCH_REQUIRED_BEFORE_BACKGROUND_TRASH`

## 9. Retry/backoff

Do not retry every failed row on every Cron invocation.

Use bounded backoff written to `reconcile_after`.

Candidate policy:

- first retry: ~5 minutes
- exponential growth by attempt count
- cap around 6 hours

Exact numbers are tunable; correctness requires only that retries are finite, bounded and do not create a hot loop.

A successful lifecycle finalization resets/clears reconciliation metadata.

## 10. Batch and execution bounds

Initial batch cap: 25 rows per scheduled run.

Process with bounded concurrency rather than unbounded `Promise.all`.

The implementation may begin sequentially or with a very small concurrency width. Reliability is more important than throughput because object reconciliation is maintenance traffic.

No broad Google Drive listing is needed.

## 11. Scheduled handler boundary

The existing module export should preserve HTTP `fetch` unchanged while adding `scheduled`.

Conceptual shape:

```text
export default {
  fetch(...),
  async scheduled(controller, env, ctx) {
    await reconcilePendingBusinessImages(env, controller.scheduledTime)
  }
}
```

No HTTP endpoint is required to invoke the reconciler in production.

This keeps the capability server-owned and avoids inventing operator media authority.

## 12. Environment configuration

Production only:

```jsonc
"env": {
  "production": {
    "triggers": {
      "crons": ["*/15 * * * *"]
    }
  }
}
```

Preview should have no Cron Trigger. If implementation adds a `triggers` block to preview for clarity, it must be an empty list.

No Cron is actually deployed during Draft acceptance.

## 13. Observability

Every scheduled run should emit aggregate structured logs such as:

- claimed count
- upload activated count
- delete retired count
- deferred count
- metadata mismatch count
- failure count

Do not log:

- resident name
- email/phone
- household address/unit
- evidence keys
- OAuth tokens
- raw Drive responses

Business-image object keys are not resident evidence, but per-object logging should still be minimized.

## 14. Interaction with request-scoped recovery

Background and request-scoped reconciliation may race.

Correctness must come from lifecycle-state conditional writes, not from assuming only one path runs.

Request-scoped success may change a row before the background worker finalizes. In that case the background conditional update affects zero rows and must treat the fresh state as authoritative.

Invariant:

`STALE_LEASE_RESULT != AUTHORITY_TO_OVERWRITE_FRESH_STATE`

## 15. Existing boundaries preserved

The background lane must preserve:

- PR #103 exact owner/complex Drive metadata binding
- PR #105 protected-reference delete guard
- PR #109 `NEW_REFERENCE XOR DELETE_INTENT`
- PR #113 pre-upload durable reservation and exact-ID recovery
- Issue #59 resident-evidence HOLD
- PADIEM/council review scopes remain unrelated to storage mutation

It must never select `active` rows for background trash.

## 16. Implementation acceptance evidence

A later implementation must prove on one exact head:

1. production-only Cron configuration parses under current Wrangler
2. `scheduled()` preserves normal `fetch`
3. two simultaneous claimers cannot both hold a valid lease for the same row
4. crashed/expired lease can be reclaimed
5. active/retired are never claimed
6. Drive calls happen after claim transaction is committed
7. upload_pending matching metadata -> active
8. upload_pending 404 -> remains pending
9. upload_pending mismatch -> remains pending, no trash
10. delete_pending absent/trashed -> retired
11. delete_pending matching live object -> exact trash then retired when confirmed
12. delete_pending mismatch -> no trash
13. ambiguous Drive result -> pending + backoff
14. stale lease token cannot finalize after a newer claim
15. batch is bounded
16. no resident-evidence query/path
17. all #103/#105/#109/#113 contracts remain green
18. real PostgreSQL concurrency evidence for lease claim/reclaim/finalize
19. isolated Neon child validates migration/schema, then child is deleted
20. no production deployment or Cron mutation occurs during acceptance

Static source assertions alone are insufficient for lease concurrency acceptance.

## 17. Architecture verdict

If accepted on an exact documentation-only head:

`BUSINESS_IMAGE_BACKGROUND_RECONCILIATION_ARCHITECTURE_ACCEPTED`

Implementation must start from that exact accepted architecture head in a separate stacked Draft PR.

**DRAFT / DO NOT MERGE.**