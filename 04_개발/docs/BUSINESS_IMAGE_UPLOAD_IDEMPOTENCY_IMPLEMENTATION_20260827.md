# BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_IMPLEMENTATION_20260827

## Scope

Implementation Issue: #120  
Architecture Issue: #118  
Architecture PR: #119  
Accepted architecture head: `53998a77300b292017fd3b683a324ec161df675b`

This implementation adds optional retry-safe idempotency capability to DanjiOn public `business-image` uploads without changing the current no-header caller contract.

## Problem closed

Before this lane, the upload protocol already ensured:

- durable `upload_pending` before Drive binary persistence,
- exact Drive file-ID reconciliation,
- autonomous pending-state recovery,
- safe retirement through `delete_pending`.

However, a successful upload followed by loss of the HTTP success response could still cause a later client retry to generate a second Drive ID and create a second active image.

`TRACKED_UPLOAD != RETRY_IDEMPOTENT_UPLOAD`

## Implemented backend contract

When `POST /api/v1/storage/objects` carries a valid `Idempotency-Key`:

1. Existing `(uploader_user_id, upload_idempotency_key)` binding is read before a Drive ID is generated.
2. The request fingerprint is SHA-256 over canonical metadata containing:
   - `kind=business-image`,
   - complex slug,
   - filename,
   - MIME type,
   - file size,
   - SHA-256 of file bytes.
3. A new candidate Drive ID may be generated only when no binding is currently visible.
4. The registry insert durably binds:
   - candidate object key,
   - uploader,
   - complex,
   - `upload_pending`,
   - idempotency key,
   - request fingerprint.
5. A partial unique index on `(uploader_user_id, upload_idempotency_key)` elects one winner.
6. Only a reservation winner may execute Drive binary upload.
7. A reservation loser reads the durable winner and reconciles that exact object key; it never uploads its candidate binary.
8. Same key + same fingerprint:
   - `upload_pending` -> exact-ID reconciliation,
   - `active` -> exact-ID metadata confirmation and same object replay.
9. Same key + different fingerprint -> `409 IDEMPOTENCY_KEY_REUSED`.
10. `delete_pending` or `retired` original lifecycle -> `409 BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_STATE_CONFLICT`; no resurrection.

## Schema

Migration:

`04_개발/backend/migrations/022_business_image_upload_idempotency.sql`

Adds to `business_image_objects`:

- `upload_idempotency_key`
- `upload_request_fingerprint`

Constraints enforce:

- both fields null or both non-null,
- key length 8-80 and bounded character set,
- lowercase 64-hex SHA-256 fingerprint.

Partial unique index:

`(uploader_user_id, upload_idempotency_key) WHERE upload_idempotency_key IS NOT NULL`

The lifecycle registry remains the single object authority; no second idempotency table is introduced.

## Compatibility boundary

No-header business-image uploads preserve the existing #113 protocol:

`GENERATE_ID -> DURABLE_UPLOAD_PENDING -> DRIVE_UPLOAD -> ACTIVE`

No frontend/UI source is modified in this lane.

Therefore:

`BACKEND_IDEMPOTENCY_CAPABILITY != CLIENT_RETRY_DEDUPLICATION_ACTIVE`

End-to-end retry deduplication is only active for integrating clients that supply a stable key across retries of the same logical upload.

## Concurrency invariant

Two same-uploader same-key requests may both temporarily observe no binding and may each obtain an unused Drive candidate ID.

The database unique index is the serialization authority:

`UNIQUE_DB_WINNER -> MAY_UPLOAD_BINARY`

`UNIQUE_DB_LOSER -> EXACT_WINNER_REPLAY_ONLY`

An unused generated Drive ID is not a persisted binary and requires no cleanup.

## Lifecycle invariants

`SAME_KEY + SAME_FINGERPRINT + ACTIVE -> SAME_OBJECT_REPLAY`

`SAME_KEY + SAME_FINGERPRINT + UPLOAD_PENDING -> EXACT_ID_RECONCILIATION`

`SAME_KEY + DIFFERENT_FINGERPRINT -> 409`

`DELETE_PENDING | RETIRED -> NO_RESURRECTION`

`NO_IDEMPOTENCY_KEY -> EXISTING_UPLOAD_PROTOCOL`

`RESERVATION_LOSER -> NO_BINARY_UPLOAD`

`OBJECT_REGISTRY == SINGLE_OBJECT_AUTHORITY`

## Tests

Executable mocked Drive/runtime test:

`04_개발/backend/tests/business-image-upload-idempotency.test.mjs`

Covers:

- fingerprint stability,
- different-byte fingerprint divergence,
- key validation,
- first keyed upload,
- lost-response style active replay,
- same-key different-file 409,
- lifecycle no-resurrection,
- direct reservation winner/loser,
- simulated concurrent lookup-miss/reservation-loser with candidate generation but zero loser binary uploads.

Real PostgreSQL 18 probe:

`04_개발/backend/tests/business-image-upload-idempotency-postgres.sh`

Covers:

- one winner per uploader/key,
- winner object/fingerprint preservation,
- same key allowed across different uploaders,
- no-key compatibility under partial unique index,
- concurrent same-key transaction serialization,
- pair/key/fingerprint constraint rejection.

Backend CI runs both the existing lifecycle/atomicity/reconciliation probe and this new idempotency probe on PostgreSQL 18.

## Privacy / authority boundaries

Unchanged:

- resident evidence remains Issue #59 policy HOLD,
- PADIEM/council/operator roles receive no new arbitrary media authority,
- upload authority remains Household v2 verified resident authority,
- public read does not imply mutation authority.

## Acceptance restrictions

During acceptance:

- no production DB write,
- no production Google Drive upload/trash,
- no production deployment,
- no merge.

Target verdict:

`BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_IMPLEMENTED`

**DRAFT / DO NOT MERGE.**
