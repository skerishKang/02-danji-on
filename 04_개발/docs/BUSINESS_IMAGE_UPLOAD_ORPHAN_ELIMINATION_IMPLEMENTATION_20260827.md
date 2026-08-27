# Business Image Upload Orphan Elimination — Implementation

Date: 2026-08-27
Issue: #112
Architecture: PR #111 exact accepted head `6ae0fabef588693d0abd0f9b6593719d91fcd6ce`
Status: IMPLEMENTATION CANDIDATE

## Implemented boundary

Business-image POST persistence now has a dedicated current upload interceptor before legacy `storage-v1`:

`generate Drive ID -> durable upload_pending -> Drive upload with same ID -> exact metadata verification -> active -> key return`

Existing `storage-v1` GET/DELETE behavior and PR #109 reference/delete retirement saga remain unchanged.

## Files

- migration 020 extends `business_image_objects` with `upload_pending`
- `storage-upload-v2.ts` owns current storage POST behavior
- `app.ts` routes tracked POST before `storage-v1`
- executable mocked-Drive/stateful-SQL contract covers upload failure/replay/reconciliation
- existing PostgreSQL 18 concurrency probe now applies 020 and exercises the extended lifecycle

## Lifecycle

`upload_pending -> active -> delete_pending -> retired`

Only `active` may be acquired as a product/application reference.

## Failure semantics

- Drive ID generation failure: no DB row, no binary upload
- DB reservation failure: no binary upload
- Drive 409: exact reserved ID metadata reconciliation; never automatic success
- Drive timeout/5xx: exact reserved ID reconciliation; no second generated ID
- Drive success + activation DB failure: key withheld, durable `upload_pending` preserved
- Drive/DB reconciliation unavailable: `upload_pending` remains fail closed
- ambiguous DB activation never triggers Drive trash in this implementation

## Recovery primitive

`reconcileBusinessImageUploadPending(...)` is server-owned and not registered as a human/operator endpoint.

It re-reads the exact lifecycle row and exact Drive file ID. Matching metadata can finalize active. Unknown state remains pending.

No PADIEM/council arbitrary media mutation authority is introduced.

## Existing boundaries preserved

- PR #103 strict owner/complex Drive reference validation
- PR #105 referenced-image delete protection
- PR #109 `NEW_REFERENCE XOR DELETE_INTENT`
- Issue #59 resident-evidence persistence/review HOLD
- legacy manager/admin is not storage authority
- no frontend/UI changes

## Acceptance required

No final verdict is claimed until one exact head closes:

- Backend CI
- PostgreSQL 18 lifecycle + concurrency job
- Pre-Infra Integration CI
- applicable Live Release Gate
- isolated Neon child migration 020 validation
- GitGuardian

No production DB write, production Drive write/trash, deploy, Ready transition, or merge is authorized.

Candidate verdict:

`BUSINESS_IMAGE_UPLOAD_ORPHAN_ELIMINATION_IMPLEMENTATION_CANDIDATE`

**DRAFT / DO NOT MERGE.**