# BUSINESS IMAGE UPLOAD IDEMPOTENCY ARCHITECTURE — 2026-08-27

Status: ARCHITECTURE CANDIDATE

Issue: #118

Base exact accepted backend head:

`af0865c541a3a44cd6da6a1e193ae6c219025be8`

## Problem

The tracked business-image upload stack now provides:

- durable `upload_pending` identity before binary persistence
- exact-ID Drive/DB reconciliation
- autonomous background recovery for stale pending states

However, those guarantees operate on one server-side object identity. A completely new HTTP retry still enters `runTrackedBusinessImageUpload()` and calls Google Drive `files.generateIds` again.

Failure mode:

`ACTIVE_COMMIT -> RESPONSE_LOSS -> CLIENT_RETRY -> NEW_DRIVE_ID -> SECOND_ACTIVE_OBJECT`

Therefore:

`TRACKED_UPLOAD != RETRY_IDEMPOTENT_UPLOAD`

## Compatibility decision

Do not make `Idempotency-Key` mandatory in this backend-only lane because the current frontend/UI lane does not supply it and this lane must not modify frontend source.

Instead:

1. add full backend idempotency capability when a valid key is present
2. preserve current no-key upload behavior for compatibility
3. explicitly classify client adoption as a release condition for end-to-end retry deduplication

This avoids silently breaking current callers while giving the later frontend integration a stable contract.

## Key format

Reuse the existing product idempotency key grammar:

`^[A-Za-z0-9._:-]{8,80}$`

Invalid supplied keys return 400 before any Drive ID is generated.

A missing key means legacy-compatible non-idempotent request semantics.

## Registry ownership

Do not create a second upload-object authority.

Migration 022 extends `business_image_objects` with:

- `upload_idempotency_key text null`
- `upload_request_fingerprint text null`

Constraints:

- key and fingerprint are both null or both non-null
- key length/grammar is bounded
- fingerprint is lowercase SHA-256 hex (`64` chars)

Partial unique index:

`unique (uploader_user_id, upload_idempotency_key) where upload_idempotency_key is not null`

The object registry remains the authoritative mapping from logical upload request to object key.

## Fingerprint

The request fingerprint must bind the logical binary request, not mutable server-generated Drive metadata.

Recommended canonical fingerprint inputs:

- complex slug
- MIME type
- file size
- SHA-256 of file bytes

Then SHA-256 the canonical JSON representation of those values.

Original local filename is intentionally excluded because it is presentation metadata and should not cause the same binary retry to be treated as a different logical upload.

The implementation must not log file bytes or fingerprint input material beyond the final bounded digest.

## New request protocol with Idempotency-Key

After canonical auth, upload policy validation and Household-v2 verified-resident authorization:

1. validate key
2. calculate request fingerprint
3. look up `(resident.id, key)` before generating a Drive ID
4. if an existing registry row exists, resolve replay rules below
5. otherwise call Drive `files.generateIds`
6. attempt `upload_pending` insert containing key + fingerprint
7. unique conflict loser reads the winning row
8. only the registry-insert winner may upload binary to Drive
9. loser resolves/reconciles the winning object key and never uploads its unused generated ID
10. winner follows the existing #113 upload protocol to exact metadata verification and activation

The unused generated ID on a losing concurrent request is not a persisted Drive object and requires no cleanup.

## Replay rules

### Same key + different fingerprint

Return:

`409 IDEMPOTENCY_KEY_REUSED`

No Drive mutation and no new object key.

### Same key + same fingerprint + active

Reconcile/confirm exact Drive metadata for the existing object key and return the same logical upload result with:

`idempotency_replayed: true`

Do not generate a new Drive ID.

### Same key + same fingerprint + upload_pending

Use the exact existing object-key reconciliation path.

- if exact object is confirmed and activation succeeds, return same key
- if state is still ambiguous/not yet persisted, return the existing fail-closed pending response
- never allocate/upload a replacement binary

This also handles concurrency where a second request observes the winner before the winner has completed Drive persistence.

### Same key + same fingerprint + delete_pending / retired

Return 409 state conflict.

An idempotency replay must not resurrect or replace an object whose lifecycle has moved into deletion/retirement.

## No-key request

No-key requests retain the current behavior:

`generate ID -> upload_pending -> exact upload -> active`

The response should explicitly expose `idempotency_replayed: false` only if doing so does not break the current response contract; otherwise the field may be added as a backward-compatible additive field.

End-to-end duplicate prevention is not claimed for no-key requests.

## Concurrency invariants

`SAME_ACTOR + SAME_KEY -> AT_MOST_ONE_REGISTRY_OBJECT`

`SAME_KEY + DIFFERENT_FINGERPRINT -> 409`

`LOSING_CONCURRENT_RESERVATION -> NO_BINARY_UPLOAD`

`ACTIVE_REPLAY -> SAME_OBJECT_KEY`

`UPLOAD_PENDING_REPLAY -> EXACT_EXISTING_ID_ONLY`

`RETIRED_REPLAY -> NO_RESURRECTION`

`NO_KEY -> LEGACY_COMPATIBILITY`

`CLIENT_KEY_ADOPTION_REQUIRED -> END_TO_END_RETRY_DEDUPLICATION`

## Relationship to background reconciliation

Migration 022 does not change migration 021 lease semantics.

Background reconciliation remains state-based and does not need to understand idempotency keys beyond preserving columns during state updates.

A background transition from `upload_pending -> active` keeps the idempotency binding, so a later client retry can discover and replay the recovered object.

## Tests

Implementation acceptance should include:

- key grammar validation before `generateIds`
- deterministic fingerprint for same bytes/complex/MIME
- different bytes or complex -> different fingerprint
- same key + same fingerprint active -> same object key, no generate/upload
- same key + different fingerprint -> 409, no generate/upload
- same key + upload_pending -> exact existing reconciliation only
- retired/delete_pending replay -> 409
- concurrent same-key insert: one registry winner, loser no binary upload
- no-key legacy path remains unchanged
- migration partial unique index on real PostgreSQL
- background lease columns/lifecycle remain intact
- resident-evidence HOLD remains intact

## Client adoption boundary

This backend architecture intentionally does not modify frontend/UI source.

Before production release claims retry-safe business-image upload semantics, the integrating client must:

- generate one stable idempotency key per logical upload action
- reuse that key across transport retries of the same file
- generate a new key for a new user-intended upload

Until then the correct product statement is:

`BACKEND_IDEMPOTENCY_CAPABILITY_READY != CLIENT_RETRY_DEDUPLICATION_ACTIVE`

## Hard boundaries

- business-image only
- no frontend/UI changes
- no resident-evidence processing; Issue #59 remains HOLD
- no new human/operator media authority
- no production DB/Drive mutation during acceptance
- no production deploy
- no merge

Candidate verdict:

`BUSINESS_IMAGE_UPLOAD_IDEMPOTENCY_ARCHITECTURE_CANDIDATE`

**DRAFT / DO NOT MERGE.**
