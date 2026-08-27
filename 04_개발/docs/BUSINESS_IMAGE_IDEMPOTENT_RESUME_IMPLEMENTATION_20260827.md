# BUSINESS_IMAGE_IDEMPOTENT_RESUME_IMPLEMENTATION_20260827

## Scope

Implementation Issue: #124  
Architecture Issue: #122  
Architecture PR: #123  
Accepted architecture head: `7d414bb793141c317df3d7adbc14fa4ac3002f10`

This lane closes the crash window after a keyed business-image request has durably reserved its exact object identity but before Google Drive binary persistence begins.

## Implemented behavior

A same-key, same-fingerprint retry now distinguishes exact Drive states while preserving the original `business_image_objects.object_key`.

### `active`

- exact metadata read/validation only,
- no upload,
- same object key replayed.

### `upload_pending` + valid exact object exists

- exact metadata is validated against folder/appProperties/uploader/complex,
- registry transitions to `active`,
- no upload is performed.

### `upload_pending` + exact 404

- absence is proven for the already reserved Drive file ID,
- registry ownership/complex/lifecycle is re-read before Drive I/O,
- if still `upload_pending`, retry file bytes are uploaded using the same reserved file ID,
- no `generateIds` call occurs,
- post-upload exact metadata is confirmed,
- registry transitions to `active`.

### exact metadata mismatch

- treated as a cross-system integrity anomaly,
- no upload,
- registry remains pending/fail-closed.

### metadata read outage

- absence cannot be proven,
- no upload,
- registry remains pending/fail-closed.

### resumed upload ambiguity

For Drive 409, 5xx, or transport failure after same-ID resume begins:

- no replacement ID is generated,
- the same exact ID is reconciled,
- valid exact metadata may activate the registry,
- otherwise the row remains pending.

### `delete_pending` / `retired`

The existing keyed replay state gate still returns 409 before resume. No resurrection is possible.

## Concurrency

The durable registry identity remains authoritative:

`ONE_REGISTRY_OBJECT -> ONE_DRIVE_ID`

The original request and a retry may overlap, but both can only persist against the same exact Drive ID. A Drive conflict is reconciled against that ID.

`CONCURRENT_RESUME != SECOND_OBJECT`

No database transaction or row lock is held across Drive I/O. After exact 404, lifecycle state is re-read before persistence.

## No migration

No schema change is required. Migration 022 already persists all identity required for safe resume:

- object key,
- uploader,
- complex,
- lifecycle state,
- upload idempotency key,
- request fingerprint.

## Runtime change

`04_개발/backend/src/storage-upload-v2.ts`

Adds the bounded helper:

`resumeIdempotentBusinessImageUploadPending(...)`

The helper contains no Drive ID generation. `idempotentReplay(...)` now receives the retry `File` and sends only `upload_pending` rows through the same-ID resume helper; `active` remains ordinary exact replay.

## Executable regression coverage

Extended:

`04_개발/backend/tests/business-image-upload-idempotency.test.mjs`

Coverage now includes:

- exact 404 -> one upload to original reserved ID -> `active`,
- resume performs zero `generateIds`,
- resumed response returns original object key,
- exact mismatch -> zero upload,
- metadata read outage -> zero upload,
- resumed upload 409 -> exact-ID reconciliation,
- resumed transport ambiguity -> exact-ID reconciliation,
- active replay -> zero upload,
- delete lifecycle -> 409/no resurrection,
- same key different fingerprint -> 409 before Drive mutation,
- existing concurrent reservation loser behavior remains protected.

The existing backend check already runs this test, so no package/workflow modification is required.

## Unchanged boundaries

- no-key upload protocol unchanged,
- scheduled background reconciler unchanged and metadata-only,
- no frontend/UI source changes,
- resident-evidence Issue #59 HOLD unchanged,
- no new PADIEM/council/operator media authority,
- public read does not imply mutation authority.

## Acceptance restrictions

- no production DB write,
- no production Google Drive upload/trash,
- no production deploy,
- no merge.

Target verdict:

`BUSINESS_IMAGE_IDEMPOTENT_RESUME_IMPLEMENTED`

**DRAFT / DO NOT MERGE.**
