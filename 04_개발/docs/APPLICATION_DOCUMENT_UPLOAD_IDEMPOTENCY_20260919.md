# Application-Document Upload Idempotency & Reconciliation Contract

Issue: #783
Date: 2026-09-19
Status: LOCAL implementation — CENTRAL review required

## 1. Scope

This contract governs **application-document** uploads on the shared `business_image_objects` lifecycle registry. It does **not** change business-image semantics, resident-evidence policy, or any public/private authorization boundary.

## 2. Idempotency Scope

An application-document reservation is scoped to:

```
(uploader_user_id, Idempotency-Key)
```

The verified complex is recorded in the reservation row and is part of the canonical request fingerprint. Replaying with the same `Idempotency-Key` but a different verified complex is a deterministic `409 APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT` — never a second private Drive object.

## 3. Canonical Request Fingerprint

The fingerprint is a SHA-256 hex digest of a canonical string containing:

```
kind = application-document
complex slug
filename
MIME type
size (bytes)
content SHA-256
```

Same key + same fingerprint + same scope replays the original object key/result. Same key + different content or different scope is a deterministic `409 IDEMPOTENCY_KEY_REUSED` or `409 APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT`.

## 4. Lifecycle States

```
upload_pending   -- durable reservation before Drive persistence
active           -- exact Drive identity proof completed
delete_pending   -- reserved for business-image retirement only
retired          -- reserved for business-image retirement only
```

Application-document rows must never enter `delete_pending` or `retired` via the upload path. Background reconciliation may activate a proven `upload_pending` row, but it must never trash or retire a private Drive object.

## 5. Drive Identity Invariant

The returned object key is:

```
gdrive/private/application-document/<pre-generated Drive file ID>
```

The pre-generated Drive file ID is bound into the multipart create request (`id: fileId`). The upload response and subsequent metadata reads must prove:

- exact Drive file ID matches the reserved ID
- parent folder == `GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID`
- `danjionKind=application-document`
- `danjionVisibility=private`
- `danjionUploaderUserId` == verified resident
- `danjionComplexSlug` == verified complex
- `trashed != true`

MIME and size are verified when Drive metadata/API can prove them safely.## 6. Replay Semantics

| Scenario | Result |
|----------|--------|
| First upload | `201`, `idempotencyReplayed: false`, state `upload_pending` -> `active` |
| Same key + same content + same scope | Replay original object key, `idempotencyReplayed: true` |
| Same key + different content | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key + different scope | `409 APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_SCOPE_CONFLICT` |
| Keyed retry while original is `upload_pending` | Same-ID resume or exact-ID reconciliation |
| Keyed retry while original is `delete_pending`/`retired` | `409 APPLICATION_DOCUMENT_UPLOAD_IDEMPOTENCY_STATE_CONFLICT` |

## 7. Ambiguous Completion

```
registry reservation success
-> Drive upload success
-> client loses HTTP success response
-> same-key retry
```

The retry must **not** create a new object. It must replay the original canonical object key after proving exact Drive metadata identity.

## 8. Registry-Drive Ambiguity

| State | Handling |
|-------|----------|
| registry `upload_pending` + Drive exists and matches | Activate and replay |
| registry `upload_pending` + Drive missing | Same-ID resume upload |
| registry `upload_pending` + Drive exists but mismatched | Fail closed `503`, no upload, no activation |
| registry `active` + Drive metadata unreadable | Fail closed `503`, no state change |
| Drive upload 409 or 5xx | Reconcile the reserved exact ID |
| Drive response ambiguous (network drop) | Reconcile the reserved exact ID |
| Registry read/write unavailable | Fail closed `503` |
| Concurrent same-key calls | Unique reservation decides winner; loser reconciles winner's exact ID |

Ownership or metadata identity that cannot be proven always fails closed.

## 9. Orphan / Reconciliation Boundary

- **No eager deletion**: a private Drive object that may be the canonical successful result is never deleted by the upload or reconciliation path.
- **Background reconciliation**: the scheduled reconciler (`worker-v2.ts`) claims `upload_pending` rows and activates them only after exact Drive identity proof. Application-document rows in `delete_pending` are deferred with `UNSUPPORTED_PRIVATE_STATE` and require operator review.
- **Privacy boundary**: reconciliation never constructs public URLs, never widens resident-evidence authority, and never bypasses AuthN/AuthZ.

## 10. Privacy / AuthZ Boundaries

- `application-document` remains **private** (`danjionVisibility=private`).
- `GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID` usage is unchanged; no new folder semantics are introduced.
- The #59 privacy HOLD on resident-evidence is preserved.
- No public exposure, no AuthZ widening, no resident-evidence authority expansion.

## 11. Migration

Migration `054_application_document_upload_idempotency.sql` is additive:

- Extends the 019 namespace constraint to cover `gdrive/private/application-document/%` keys.
- Adds `chk_application_document_object_kind` (`business-image | application-document`).
- Safely replaces the historical 022 un-scoped `uq_business_image_upload_idempotency` index with a kind-scoped index (`where kind = 'business-image' and upload_idempotency_key is not null`) without modifying historical migration 022.
- Adds unique index `uq_application_document_upload_idempotency` on `(uploader_user_id, upload_idempotency_key)` where `kind = 'application-document' and upload_idempotency_key is not null`.
- Adds `idx_application_document_upload_pending` for pending-row lookup.

No production DB apply, no historical migration rewrite, no renumbering.

## 12. Unit & Integration Tests

`tests/application-document-upload-idempotency.test.mjs` proves:

1. First application-document upload
2. Same-key + same-content replay
3. Same-key + different-content conflict
4. Same-key + different-scope conflict
5. Concurrent same-key requests (race loser reconciles winner)
6. Drive success + client response loss simulation
7. Drive upload failure
8. Registry reservation failure
9. Activation failure after Drive success (row stays `upload_pending`)
10. Reconciliation retry (409/5xx/ambiguous)
11. Returned object key ID == actual Drive file ID
12. Failed upload cannot leave `state=active`
13. Private visibility preserved
14. #59 resident-evidence HOLD preserved
15. Cross-kind idempotency lane isolation (same uploader + same key K can be used independently by business-image and application-document without cross-kind replay or conflict)

## 13. Real PostgreSQL 18 Concurrency & Constraint Verification

`tests/application-document-upload-idempotency-postgres.sh` runs against ephemeral PostgreSQL 18 in CI:

1. Migrations 019 -> 020 -> 021 -> 022 -> 045 -> 054 apply in order cleanly
2. Private application-document namespace insert succeeds, invalid prefix rejected
3. Business-image namespace remains normal, invalid prefix rejected
4. Application-document same uploader + same key = one durable winner
5. Concurrent same-key insert = exactly one winner
6. Loser cannot replace winner object
7. Same key + different uploader is allowed
8. Business-image and application-document can use the same uploader/key independently
9. Invalid key/fingerprint pair constraints fail closed
10. Application-document upload_pending -> active state transition is normal and guarded by schema constraints

