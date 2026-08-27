# BUSINESS_IMAGE_IDEMPOTENT_RESUME_ARCHITECTURE_20260827

## Authority

Issue: #122  
Accepted predecessor implementation: PR #121  
Predecessor exact head: `56edc1d0fbddce8e72a444304475d5646e7d6b1c`

## Problem

PR #121 makes a keyed business-image upload retry-safe across lost HTTP responses by binding one uploader/idempotency key to one durable registry object and request fingerprint.

A narrower crash window remains:

1. request fingerprint is verified,
2. an exact Drive ID is generated,
3. the registry row is durably committed as `upload_pending`,
4. the process dies before Drive binary persistence,
5. the client retries with the same key and same file,
6. the backend discovers the original row,
7. exact Drive metadata is 404,
8. current replay remains 503/pending.

This is safe from duplication but not live-recoverable from the retry itself.

`DURABLE_IDEMPOTENT_RESERVATION != RESUMABLE_BINARY_UPLOAD`

## Decision

A same-key, same-fingerprint retry may resume binary persistence **only** against the already reserved exact Drive ID.

It must never generate a replacement ID.

The retry is uniquely capable of doing this because it still carries the original file bytes and PR #121 has already proven those bytes/metadata match the durable request fingerprint.

Background reconciliation remains metadata-only because it does not possess trusted file bytes.

## Preconditions

All must be true before resume is allowed:

- canonical caller authentication succeeded,
- Household v2 verified-resident authority succeeded,
- `Idempotency-Key` is valid,
- durable key binding exists for the same uploader,
- stored request fingerprint equals the retry fingerprint,
- stored complex equals current verified-resident complex,
- registry lifecycle state is `upload_pending`,
- object key parses to one exact DanjiOn business-image Drive file ID.

Failure of any precondition is fail-closed.

## Exact-ID state machine

### `active`

No upload is allowed.

Read exact metadata, verify DanjiOn folder/appProperties ownership/complex binding, and replay the same object key.

### `upload_pending` + exact valid metadata exists

No upload is needed.

Activate the registry row and replay the same object key.

### `upload_pending` + exact metadata returns 404

Resume is allowed using the **same reserved Drive file ID** and the retry's fingerprint-matched file bytes.

No `generateIds` call occurs.

### `upload_pending` + exact metadata mismatch

No upload is allowed.

An existing mismatched object at the reserved ID is a cross-system integrity anomaly, not an empty reservation.

Return fail-closed and leave the registry row pending for investigation/reconciliation.

### `upload_pending` + metadata read outage

No upload is allowed because absence has not been proven.

Return 503 and preserve pending state.

### `delete_pending` / `retired`

No upload or resurrection is allowed.

Return 409.

## Resume upload outcome

If exact 404 was proven and resume begins:

### upload success

- read exact metadata again,
- require exact DanjiOn folder/appProperties/user/complex match,
- transition `upload_pending -> active`,
- return the original object key.

### upload returns 409

Treat as an overlap/ambiguous exact-ID outcome.

Read and reconcile the same exact ID only.

A valid exact object may be activated; otherwise remain fail-closed.

### upload returns 5xx or transport throws

Do not create a replacement object.

Reconcile the same exact ID only.

### upload returns deterministic non-retryable rejection

Return controlled failure and preserve durable pending state. No alternate ID is created.

## Concurrency reasoning

The original request and a retry can overlap after the same durable reservation.

Both are constrained to one registry object and one Drive file ID:

`ONE_REGISTRY_OBJECT -> ONE_DRIVE_ID`

If both attempt persistence against the same ID, Drive can accept at most the object at that identity; a conflict is reconciled by exact ID.

Therefore:

`CONCURRENT_RESUME != SECOND_OBJECT`

An implementation must prove:

- resume path has no `generateIds`,
- retry uses stored object key/file ID,
- 409/ambiguous outcomes reconcile exact ID,
- no new registry row is inserted during replay/resume.

## Metadata mismatch boundary

404 and mismatch are intentionally distinct.

`404` means no current object was found at that exact ID and permits same-ID resume with verified retry bytes.

`METADATA_MISMATCH` means an object exists but is not the expected DanjiOn business image.

Therefore:

`EXACT_404 + VERIFIED_RETRY_FILE -> SAME_ID_RESUME_ALLOWED`

`EXACT_OBJECT_MISMATCH -> NO_DRIVE_MUTATION`

`METADATA_READ_OUTAGE -> NO_DRIVE_MUTATION`

## Relationship to background reconciliation

PR #117's scheduled reconciler remains unchanged.

It may:

- observe valid exact metadata and activate,
- observe 404/mismatch/outage and defer with bounded retry metadata,
- never synthesize or upload binary content.

Only an authenticated keyed retry with matching file fingerprint may supply binary content for same-ID resume.

`BACKGROUND_NO_FILE_BYTES -> NO_BINARY_RESUME`

## Schema

No migration is required.

PR #121 migration 022 already provides all durable identity required for safe resume:

- object key,
- uploader,
- complex,
- lifecycle state,
- upload idempotency key,
- upload request fingerprint.

## API compatibility

No new endpoint is introduced.

`POST /api/v1/storage/objects` remains the route.

No-key uploads remain unchanged.

Keyed active replay remains unchanged.

Only same-key/same-fingerprint `upload_pending` replay gains the ability to resume an exact 404 reservation.

## Tests required

Implementation acceptance must execute at least:

- keyed `upload_pending` + exact 404 -> same reserved ID upload -> active,
- resume path performs zero `generateIds`,
- resumed response returns original object key,
- metadata mismatch -> zero upload,
- metadata read outage -> zero upload,
- resumed upload 409 -> exact-ID reconciliation,
- resumed transport ambiguity -> exact-ID reconciliation,
- active replay -> zero upload,
- delete_pending/retired -> zero upload and 409,
- same key different fingerprint -> zero upload and 409,
- no-key legacy protocol unchanged,
- prior idempotency/concurrency/background contracts remain green.

## Client adoption boundary

This architecture does not modify frontend/UI source.

`BACKEND_IDEMPOTENCY_CAPABILITY_READY != CLIENT_RETRY_DEDUPLICATION_ACTIVE`

Same-ID resume is usable only when the integrating client sends and reuses a stable key with the same logical file retry.

## Hard boundaries

- business-image only,
- backend only,
- no frontend/UI changes,
- no resident-evidence processing; Issue #59 remains HOLD,
- no new PADIEM/council/operator arbitrary storage authority,
- no production DB/Drive mutation during acceptance,
- no deploy,
- no merge.

## Verdict

`BUSINESS_IMAGE_IDEMPOTENT_RESUME_ARCHITECTURE_ACCEPTED`

**DRAFT / DO NOT MERGE.**
