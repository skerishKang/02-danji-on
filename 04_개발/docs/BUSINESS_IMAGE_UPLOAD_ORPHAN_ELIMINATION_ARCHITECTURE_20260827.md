# Business Image Upload Orphan Elimination Architecture

Date: 2026-08-27
Status: ARCHITECTURE CANDIDATE
Issue: #110
Base: PR #109 exact accepted head `337b7959455a6d62d2c296219f3f30cbb6cbf368`

## 1. Problem

PR #109 closes the application-reference versus delete-intent race, but its current upload sequence is still:

`verified resident -> Drive upload -> registry insert(active) -> return key`

If Drive succeeds and PostgreSQL registration fails, the key is correctly withheld but the Drive object has already been created. The current runtime explicitly describes that object as an orphan candidate.

Therefore:

`KEY_NOT_RETURNED != ORPHAN_ELIMINATED`

`DRIVE_SUCCESS + REGISTRY_FAILURE -> UNTRACKED_STORAGE_OBJECT`

The next boundary must ensure that every possible persisted business-image binary has a durable DanjiOn lifecycle identity before the binary can exist.

## 2. Selected architecture

Use Google Drive pre-generated IDs.

Google Drive v3 supports `files.generateIds`; a generated ID can then be supplied in a file create/upload request. A retry using an already-created pre-generated ID does not create a duplicate object.

Official references:

- https://developers.google.com/workspace/drive/api/guides/create-file
- https://developers.google.com/workspace/drive/api/guides/manage-uploads

This lets DanjiOn know the final Google file ID and final object key before binary persistence.

## 3. Target lifecycle

Extend the business-image-only registry lifecycle from:

`active -> delete_pending -> retired`

to:

`upload_pending -> active -> delete_pending -> retired`

Meanings:

- `upload_pending`: exact Drive file ID/object key is durably reserved by DanjiOn, but no product reference may use it yet.
- `active`: Drive object existence/metadata has been confirmed and the object may be acquired as a product reference subject to the existing #103/#109 owner/complex checks.
- `delete_pending`: authoritative delete intent has committed; new references are denied and Drive retirement is being reconciled.
- `retired`: Drive retirement is confirmed or the object is authoritatively absent after a committed lifecycle transition.

Invariant:

`REFERENCE_ALLOWED <=> REGISTRY_STATE_ACTIVE`

`UPLOAD_PENDING != PRODUCT_REFERENCE`

## 4. New upload protocol

For `POST /api/v1/storage/objects` with `kind=business-image`:

1. canonical DanjiOn account authentication
2. storage payload validation
3. Household-v2 verified-resident authorization for the canonical complex
4. Drive `files.generateIds?count=1&space=drive`
5. validate returned file ID against the existing Drive ID grammar
6. derive the final object key:
   `gdrive/public/business-image/<pre-generated-id>`
7. insert `business_image_objects` row as `upload_pending`, binding:
   - exact object key
   - canonical uploader `app_users.id`
   - canonical complex id
8. only after the durable row exists, upload the binary using the same pre-generated Drive file ID
9. validate upload response/read-back metadata:
   - exact file ID
   - expected folder
   - `danjionKind=business-image`
   - `danjionVisibility=public`
   - exact uploader id
   - exact complex slug
10. conditionally transition the same registry row `upload_pending -> active`
11. return the object key only after `active` is confirmed

Core ordering:

`PREGENERATED_ID < DURABLE_UPLOAD_PENDING < DRIVE_BINARY_PERSISTENCE < ACTIVE < KEY_RETURN`

## 5. Drive upload metadata

The create/upload request must explicitly include the pre-generated `id` in Drive file metadata.

Existing server-controlled `appProperties` remain authoritative:

- `danjionKind=business-image`
- `danjionVisibility=public`
- `danjionUploaderUserId=<canonical app user id>`
- `danjionComplexSlug=<canonical complex slug>`

No client-supplied property becomes authority.

## 6. Failure matrix

### 6.1 Drive ID generation fails

No DB row exists and no binary is uploaded.

Return storage-unavailable/fail-closed.

### 6.2 `upload_pending` insert fails

No Drive upload is attempted.

Invariant:

`NO_DURABLE_UPLOAD_PENDING -> NO_BINARY_PERSISTENCE`

### 6.3 Drive upload returns a definitive non-ambiguous failure

The binary is not considered active.

The `upload_pending` row remains non-referenceable until a bounded reconciliation step proves absence or a later safe retry completes the same pre-generated ID.

Do not invent product success from a failed upload response.

### 6.4 Drive upload returns 409 for the pre-generated ID

Treat this as a possible safe retry/replay case, not automatic success.

Read exact Drive metadata for that known ID.

- exact expected metadata + not trashed -> eligible for `upload_pending -> active`
- mismatch -> fail closed; never activate
- metadata unavailable -> keep `upload_pending`

### 6.5 Drive upload throws, times out, or returns an ambiguous 5xx

Do not create another ID and do not retry with a new object key inside the same attempt.

Because the object ID is already known, reconcile by exact `files.get(fileId)`.

- valid matching object exists -> eligible to activate
- exact state cannot be established -> keep `upload_pending`

A transient 404 after an ambiguous create must not be treated as sufficient evidence for destructive cleanup unless the recovery policy explicitly establishes an authoritative absence condition.

### 6.6 Drive succeeds but DB activation fails

This is the critical case solved by this architecture.

The object key was already durably recorded as `upload_pending` before Drive persistence.

Therefore:

`DRIVE_SUCCESS + ACTIVE_FINALIZATION_FAILURE -> TRACKED_UPLOAD_PENDING`

not:

`UNTRACKED_ORPHAN`

The API must not return the object key while activation is unresolved.

### 6.7 Activation response is ambiguous

Before any cleanup, re-read the registry row.

- `active` -> preserve object; success may be replayed only if the request contract can prove it is the same upload operation
- `upload_pending` -> keep fail-closed and reconcile
- DB unavailable -> do not trash the Drive object because an active commit may have succeeded but its response may have been lost

This prevents a compensation action from deleting a successfully activated object.

## 7. Recovery seam

The implementation must provide a server-owned reconciliation function for exact `upload_pending` rows. It does not need to grant a human/operator arbitrary media-delete permission.

Input is a registry row with an exact object key/file ID.

Recovery logic:

1. re-read current registry state
2. if already `active`, stop successfully
3. if not `upload_pending`, route to the existing lifecycle handler for that state
4. read exact Drive metadata using the reserved file ID
5. matching, non-trashed object -> transition to `active`
6. missing/trashed object -> remain fail-closed until the implementation's authoritative-absence rule is satisfied; then retire/clear only through an audited server-owned transition
7. metadata/API unavailable -> keep `upload_pending`

No broad Drive `files.list` scan is required for core recovery because the exact file ID is known before upload.

## 8. Recovery trigger boundary

This architecture separates **reconcilability** from scheduler ownership.

Required in the first implementation:

- an executable server-side reconciliation primitive
- deterministic tests for all recovery outcomes
- no user/operator endpoint that widens media-delete authority

A later infrastructure lane may attach that primitive to a scheduled/background trigger. The absence of a scheduler must not weaken the central invariant that every possibly persisted object is durably tracked.

## 9. Schema direction

A later migration (expected next number: 020, subject to fresh verification at implementation time) should extend `business_image_objects` to support `upload_pending` and preserve coherent lifecycle constraints.

Do not create a second authoritative object registry unless implementation evidence shows the existing registry cannot safely represent pre-upload reservation.

Preferred model:

`one exact object_key -> one lifecycle row`

The migration must be forward-safe for any existing `active/delete_pending/retired` rows.

## 10. Interaction with PR #109

PR #109 remains authoritative for reference/delete atomicity after activation.

The new architecture changes only the pre-active upload boundary.

Preserve:

- `active` row lock before new application reference acquisition
- `delete_pending|retired` new-reference denial
- `NEW_REFERENCE XOR DELETE_INTENT`
- protected-reference checks
- retirement saga
- legacy unregistered historical delete compatibility, if still required by the stacked ancestry

New combined lifecycle invariant:

`UPLOAD_PENDING -> NO_REFERENCE`

`ACTIVE -> REFERENCE_OR_DELETE_INTENT_SERIALIZED`

`DELETE_PENDING|RETIRED -> NO_NEW_REFERENCE`

## 11. Resident evidence boundary

This architecture is business-image-only.

Issue #59 remains OPEN/HOLD.

Do not apply pre-generated upload persistence to resident verification evidence while new resident-evidence persistence is held.

`BUSINESS_IMAGE_UPLOAD_RECOVERY != RESIDENT_EVIDENCE_POLICY_DECISION`

## 12. Authorization boundary

No new human media authority is introduced.

- uploader identity remains canonical product user identity
- upload still requires Household-v2 verified resident for the complex
- PADIEM `business.review` and council `council.business.review` remain application-review authority only
- neither scope becomes arbitrary storage deletion/recovery authority
- management-office/onboarding support remains outside operational storage mutation

## 13. Required executable evidence for implementation

Implementation acceptance must prove at least:

1. Drive ID is generated before DB reservation
2. `upload_pending` DB reservation succeeds before Drive binary upload
3. reservation failure prevents Drive upload
4. upload request uses exactly the pre-generated Drive ID
5. object key is not returned before `active`
6. `upload_pending` cannot acquire an application/product reference
7. valid upload finalizes `active`
8. Drive 409 replay requires exact metadata verification
9. ambiguous Drive result uses exact-ID reconciliation and cannot create a second ID/object
10. DB activation failure leaves a durable `upload_pending` row
11. ambiguous DB activation result never triggers unsafe Drive trash
12. recovery of a matching Drive object can finalize `active`
13. unavailable Drive reconciliation leaves `upload_pending`
14. #109 reference/delete PostgreSQL concurrency tests remain green
15. #103 owner/complex Drive metadata validation remains green
16. resident-evidence HOLD remains unchanged
17. no frontend/UI source change

At least one integration test must exercise a real PostgreSQL lifecycle transition for the new state; static source-order checks alone are insufficient.

## 14. Validation boundaries

- Neon production: read-only only
- migration validation: isolated Neon child only, then delete child
- Google Drive production writes: prohibited in this architecture/implementation acceptance unless a separately approved non-production Drive target exists
- no production deploy
- no merge

## 15. Architecture verdict

If the above design is accepted on an exact documentation head:

`BUSINESS_IMAGE_UPLOAD_ORPHAN_ELIMINATION_ARCHITECTURE_ACCEPTED`

Implementation must then start from that exact accepted architecture head in a new stacked Draft PR.

**DRAFT / DO NOT MERGE.**