# Business Image Cross-System Atomicity Architecture — 2026-08-27

Status: design-independent backend architecture decision

Refs: #106, #107, #105, #104, #103, #102, #101, #100, #90

Architecture base:

`cec360450c48e3215c8a8f617860306389b9bb4b` — PR #105 exact accepted head

## 1. Decision

DanjiOn will close the business-image create/resubmit/delete race with a **PostgreSQL-authoritative business-image object registry and lifecycle state machine**, using short database critical sections and a recoverable Google Drive side-effect saga.

Selected working registry:

`business_image_objects`

Selected lifecycle:

```text
active -> delete_pending -> retired
```

The database serializes **new reference acquisition** against **delete intent**. Google Drive is never called while a database transaction or row lock is held.

Architecture verdict:

`BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_DESIGNED`

This document is architecture-only. It does not authorize migration, runtime, deployment, production DB, or production Drive mutation.

---

## 2. Existing accepted controls

### PR #103 — reference authenticity

Representative-image references are validated against Google Drive server-controlled metadata on:

- new business application create;
- `changes_requested` applicant resubmit;
- operator approval before materializing `business_media`.

The external object must be a current DanjiOn public business image, in the expected folder, not trashed, and bound to the canonical applicant and complex.

### PR #105 — existing-reference delete guard

Uploader self-delete already fails closed when the image is currently referenced by:

- any `business_media.object_key`; or
- `business_applications.representative_image_object_key` in `draft`, `pending`, `changes_requested`, or `approved`.

Database reference-check failure also blocks Drive trash.

These controls remain mandatory. They do not by themselves serialize operations that begin concurrently.

---

## 3. Proven TOCTOU gap

Current create/resubmit is logically:

```text
Drive validate
  -> PostgreSQL INSERT/UPDATE reference
```

Current delete is logically:

```text
PostgreSQL reference check
  -> Google Drive trash PATCH
```

Two requests can interleave:

```text
CREATE/RESUBMIT                    DELETE
-------------------------------    -------------------------------
Drive image validates              DB sees no current reference
                                   Drive trash begins/succeeds
DB persists the image key
```

or:

```text
DELETE                             CREATE/RESUBMIT
-------------------------------    -------------------------------
DB sees no current reference       Drive image validates
Drive trash begins
                                   DB persists the image key
```

Therefore:

```text
REFERENCE_CHECK_PASS != CROSS_SYSTEM_ATOMICITY
VALIDATE_THEN_INSERT + CHECK_THEN_TRASH -> TOCTOU_RISK
```

The safety property required is:

```text
NEW_REFERENCE XOR DELETE_INTENT
```

for the same business-image object.

---

## 4. Runtime constraints

Current backend characteristics at the architecture base:

- Cloudflare Worker runtime;
- `@neondatabase/serverless` `neon(DATABASE_URL)` HTTP query functions;
- no Hyperdrive binding;
- no session-oriented Pool/Client transaction layer;
- Google Drive is an external HTTP side effect.

The Neon HTTP transaction helper is non-interactive: multiple SQL commands may be grouped in one database transaction, but application code cannot pause that transaction, perform arbitrary Google Drive I/O, then continue it interactively.

A session-capable driver could technically support interactive locks, but the selected design does not require that connection-model change.

### Rejected architecture

Do **not** use:

```text
BEGIN
  -> acquire advisory/row lock
  -> call Google Drive while DB lock remains open
  -> finish DB state
COMMIT
```

This is rejected because it would:

- require a new connection model solely for this boundary;
- introduce long lock/transaction duration across external I/O;
- increase timeout and failure-recovery complexity;
- still require compensation if execution dies around the external side effect;
- be unnecessary when the race can be serialized with short DB state transitions.

Hyperdrive is not introduced by this architecture decision.

---

## 5. Business-image registry

Use a business-image-specific table so resident-verification evidence remains outside this lifecycle and Issue #59 stays isolated.

Working logical shape:

```text
business_image_objects
- object_key                  canonical unique/primary serialization key
- uploader_user_id            canonical app_users identity
- complex_id                  canonical complexes identity
- state                       active | delete_pending | retired
- created_at
- updated_at
- delete_requested_at         nullable
- retired_at                  nullable
```

Implementation may add bounded observability/retry metadata if needed, but it must not alter the lifecycle invariant.

### Registry rules

- one canonical registry row per returned DanjiOn business-image object key;
- registry rows are retained after retirement;
- only `active` rows can acquire new product references;
- `delete_pending` and `retired` cannot acquire new references;
- registry uploader and complex binding is immutable for the object lifecycle;
- resident-evidence objects are never inserted into this table.

---

## 6. Upload registration protocol

Business-image upload becomes:

```text
1. canonical account auth
2. Household-v2 verified-resident authority
3. Google Drive upload
4. short DB insert: business_image_objects(state=active)
5. return object key to caller
```

The registry row is populated from server-authoritative facts already available after upload:

- returned canonical object key;
- canonical resident `app_users.id`;
- canonical complex id;
- server-controlled Drive metadata binding.

### Registry insert failure

If Drive upload succeeds but DB registry insertion fails:

- fail the API request;
- do not return the object key to the client;
- do not allow that unregistered object to become a product reference.

The Drive file may become an orphan candidate. This is a resource-leak concern, not a broken-reference safety violation. Orphan cleanup is deliberately separate from this atomicity lane.

Safety must not depend on cleanup compensation succeeding.

---

## 7. PostgreSQL snapshot rule — implementation-critical

The serialization design depends on a subtle PostgreSQL rule and must not be simplified incorrectly.

At the default `READ COMMITTED` isolation level, each **command** receives a statement snapshot. If a command starts, then waits on a row lock held by another transaction, it is unsafe to assume every unrelated-table read later inside that same command will necessarily observe rows committed while the command was waiting.

Therefore, the accepted delete protocol must **not** collapse all of the following into one SQL statement without a separate, proven isolation argument:

```text
lock registry row
+ wait for competitor
+ query business_applications/business_media
+ mark delete_pending
```

The bounded implementation contract is instead:

```text
SHORT DB TRANSACTION
  Statement A: lock the registry row
  Statement B: with a new READ COMMITTED command snapshot,
               check protected references and conditionally change state
COMMIT
```

Statement B executes only after Statement A has acquired the serialization row lock. If Statement A had to wait for a competing reference transaction to commit, Statement B obtains a fresh command snapshot and can observe that newly committed reference.

This transaction remains non-interactive from application code and contains DB commands only. It is compatible in principle with the current Neon HTTP transaction model.

The same conservative multi-command pattern may be used for reference acquisition as well. A single-statement reference acquisition can be accepted only if its row-lock/state recheck semantics are explicitly tested under concurrency.

### Mandatory concurrency test implication

Implementation tests must exercise real concurrent DB transactions, not only source-order assertions or sequential mocks.

Required cases:

```text
REFERENCE_TRANSACTION_LOCKS_FIRST
  -> DELETE lock waits
  -> reference commits
  -> DELETE second command sees reference
  -> DELETE denied

DELETE_TRANSACTION_LOCKS_FIRST
  -> delete_pending commits
  -> REFERENCE lock/state check resumes
  -> non-active registry detected
  -> REFERENCE denied
```

---

## 8. New reference acquisition — create

PR #103 Drive validation remains first as an external-integrity check.

For an application containing a representative image, the DB persistence phase must then atomically:

```text
BEGIN short DB transaction
  lock registry row by object_key
  require state = active
  require uploader_user_id = verified resident id
  require complex_id = canonical resident complex id
  insert business_applications with object_key only if all requirements remain true
COMMIT
```

The registry lock/state check and application insert must share one database transaction.

A safe implementation may use two short SQL commands in the existing non-interactive transaction helper:

```text
A. SELECT registry row FOR UPDATE
B. conditional INSERT ... SELECT from active/matching registry row
```

No external Drive call is inside this transaction.

If a one-statement CTE form is chosen instead, implementation must prove with an actual concurrency test that a row updated to `delete_pending` while the statement waits cannot still authorize the reference insert.

### Idempotency

Completed idempotent replay continues to resolve before any new external Drive validation or registry reference acquisition, preserving PR #103 semantics.

No-image applications remain independent of the registry.

---

## 9. Reference replacement — changes-requested resubmit

Resubmit may replace one representative image with another.

For a replacement image, after the existing owner/state/verified-resident checks and PR #103 Drive validation, the DB mutation must atomically:

```text
BEGIN short DB transaction
  lock new image registry row
  require new image state = active
  require new image uploader/complex binding
  update application representative_image_object_key + status=pending
COMMIT
```

A conservative two-command transaction is preferred for the same reason as create.

With the current direct application-reference model, the application row itself remains the protected reference. If implementation later introduces an explicit reference table/count, old-reference release and new-reference acquisition must occur in the same short transaction.

No external Drive call belongs inside the DB critical section.

---

## 10. Delete-intent acquisition

Business-image delete becomes a lifecycle-aware two-stage operation.

### Stage A — short database transaction

For a registry row currently `active`:

```text
BEGIN short DB transaction

Statement A
  lock business_image_objects row by object_key FOR UPDATE
  require canonical uploader binding

Statement B — fresh READ COMMITTED command snapshot
  require state still active
  check protected application/business references
  if referenced:
    no state change
  else:
    set state = delete_pending
    set delete_requested_at

COMMIT
```

After transaction results are returned:

- protected reference -> 409;
- registry missing/foreign/non-active -> controlled lifecycle result;
- DB unavailable -> 503 fail closed;
- only a committed transition to `delete_pending` authorizes a new Drive trash attempt.

The existing PR #105 protected-reference policy remains:

- any `business_media.object_key` reference blocks delete;
- application states `draft`, `pending`, `changes_requested`, `approved` block delete;
- `rejected` is not an indefinite retention rule.

### Why two DB commands are required

If a create/resubmit transaction already holds the registry row lock, delete Statement A waits. When that reference transaction commits, delete Statement A acquires the row. Statement B then starts with a fresh command snapshot and sees the newly committed application reference.

That fresh second snapshot is part of the architecture contract.

### Stage B — external Drive side effect

Only after `delete_pending` is committed:

```text
PATCH Drive file -> trashed=true
```

No new reference can be acquired while this request is in flight because every reference acquisition requires registry state `active`.

---

## 11. Serialization proof

### Case A — reference acquisition wins first

```text
CREATE/RESUBMIT transaction
  lock active registry row
  persist application reference
  commit

DELETE transaction
  Statement A was waiting for registry row
  acquires lock after reference commit
  Statement B starts fresh snapshot
  sees committed protected reference
  leaves registry active
  returns 409
```

Result:

```text
REFERENCE committed
DELETE_INTENT denied
```

### Case B — delete intent wins first

```text
DELETE transaction
  lock active registry row
  fresh second command sees no protected ref
  set delete_pending
  commit

CREATE/RESUBMIT transaction
  waits for same registry row
  resumes after delete commit
  sees state != active
  conditional reference write returns no row / fails closed
```

Result:

```text
DELETE_INTENT committed
NEW_REFERENCE denied
```

This closes the application-controlled race without keeping a DB transaction open during Google Drive I/O.

---

## 12. Delete authorization and retry ordering

The initial #105 runtime authorizes mutation by reading current Drive metadata, requiring the object to be valid/not trashed, then checking uploader metadata.

The registry implementation must preserve **uploader-only authority**, but retry semantics require a lifecycle-aware ordering change.

### Active initial delete

For `active`, implementation may continue to corroborate the current Drive metadata/folder/kind/uploader before acquiring delete intent. The registry uploader binding must also match the canonical caller.

### delete_pending retry

For `delete_pending`, the endpoint must **not** begin with a helper that rejects `trashed=true` or Drive 404 as an ordinary invalid/not-found object.

A prior delete attempt may already have successfully trashed the file before the Worker crashed or lost the response.

Therefore retry flow must first authenticate/parse and read the registry lifecycle state, then use a retirement-aware Drive probe that can distinguish:

- live/not-yet-trashed -> retry trash;
- already trashed -> finalize retired;
- absent in a way consistent with completed retirement -> finalize retired under the bounded retirement rule;
- ambiguous/unavailable -> remain delete_pending and return 503.

### retired retry

`retired` returns an idempotent success without requiring the object to remain readable from Drive.

Thus:

```text
STRICT_ACTIVE_METADATA_VALIDATION != RETIREMENT_RECONCILIATION_PROBE
```

The implementation should separate those helpers rather than weakening PR #103 active-reference validation.

---

## 13. Drive completion and crash recovery

### Success

If Drive trash succeeds, use a new short DB update:

```text
delete_pending -> retired
retired_at = now()
```

The finalize update must require the expected current state so an unrelated transition cannot be overwritten.

### Failed or ambiguous Drive response

Do not restore `active` automatically.

Keep:

```text
state = delete_pending
```

and return a controlled 503-class error.

Reason: the side effect may have succeeded even if the Worker did not receive or finish processing the response. Reopening the object for new references could create a stale reference.

Safety favors temporary unavailability over allowing a new reference to an ambiguously retired object.

### Crash windows covered

The state machine safely recovers:

- crash after `delete_pending` commit but before Drive PATCH;
- crash after Drive PATCH succeeds but before DB finalization;
- transient Drive error;
- lost/ambiguous Drive response.

A scheduled reconciler may later process long-lived `delete_pending` rows, but it is not required for concurrency safety because `delete_pending` already blocks reference acquisition.

---

## 14. Approval and `business_media`

No new cross-system lock is required during approval.

Before approval, the application already contains the representative image reference. The delete-intent transaction therefore observes that protected application reference and cannot transition the registry to `delete_pending`.

PR #103 approval-time Drive revalidation remains required before approval materialization.

The approved business public API consumes `business_media.object_key`; under current write/read paths that relationship is the materialized representative business image.

---

## 15. Referential-integrity recommendation

During implementation, evaluate nullable foreign keys:

```text
business_applications.representative_image_object_key
  -> business_image_objects.object_key

business_media.object_key
  -> business_image_objects.object_key
```

Registry rows are retained, so historical or rejected application rows can still point to a retired registry row.

Important:

```text
FK_EXISTENCE != ACTIVE_STATE_AUTHORIZATION
```

The concurrency guarantee comes from explicit registry state + transaction serialization in mutation paths. A foreign key only improves existence integrity.

Avoid trigger-based hidden lifecycle authority unless explicit bounded write paths prove insufficient.

---

## 16. Error semantics for implementation

Exact public wording can be finalized in implementation, but semantic classes should be stable.

### Reference acquisition

Structurally valid Drive image but registry missing/non-active/retiring:

```text
BUSINESS_IMAGE_NOT_ACTIVE -> 409
```

Registry database unavailable:

```text
BUSINESS_IMAGE_REGISTRY_UNAVAILABLE -> 503
```

PR #103 external Drive validation errors remain unchanged for missing/invalid/foreign uploader/foreign complex conditions.

### Delete

Existing product reference:

```text
BUSINESS_IMAGE_IN_USE -> 409
```

Registry/reference DB unavailable:

```text
503 fail closed
```

Ambiguous Drive retirement after authoritative `delete_pending`:

```text
503, state remains delete_pending
```

---

## 17. Production / rollout gate

Read-only production audit on 2026-08-27:

- Neon project: Danjion
- PostgreSQL: 18.6
- `business_applications` total rows: 0
- application representative-image refs: 0
- `business_media` total rows: 0
- `business_media.object_key` refs: 0
- no business-image registry exists
- production is behind the currently accepted repository migration chain; accepted migration 018 is not yet present there.

This means there is currently no production image-reference data requiring backfill.

This is **not** a permanent assumption.

Immediately before any future registry migration/deploy:

```text
fresh production reference count == 0
  -> bounded empty-state rollout may proceed through normal migration gates

fresh production reference count > 0
  -> STOP automatic rollout
  -> perform Drive-metadata-backed backfill audit first
```

Do not infer production schema parity from GitHub accepted code. Deployment must apply and validate the full migration ancestry in order.

The likely next repository migration number is 019 after 018, but this architecture document does not create migration 019.

---

## 18. Explicit non-goals

This architecture phase does not decide or implement:

- resident-evidence storage lifecycle;
- Issue #59 verification provider/reviewer policy;
- retention duration;
- rejected-application retention duration;
- orphan garbage collection;
- operator/PADIEM/council media-delete scope;
- permanent Drive deletion;
- UI/frontend behavior;
- Hyperdrive adoption;
- a general-purpose storage registry for unrelated object kinds.

---

## 19. Implementation phase acceptance criteria

A later implementation is not complete until executable contracts prove at least:

1. business-image upload returns a key only after `active` registry registration;
2. create locks/checks an `active` registry row in the same DB transaction as application insert;
3. resubmit does the same for replacement reference update;
4. delete uses a short transaction with a registry-lock command followed by a fresh-snapshot reference-check/state-transition command;
5. implementation does not collapse delete into an unproven single-statement stale-snapshot pattern;
6. referenced objects remain 409;
7. `delete_pending` rejects every new reference;
8. Drive is called only after delete intent commits;
9. Drive failure keeps `delete_pending`;
10. retry path can observe already-trashed/missing retirement state instead of being blocked by strict active metadata validation;
11. retry can finalize a stuck `delete_pending` object;
12. `retired` delete is idempotent and cannot become a new reference;
13. PR #103 owner/complex Drive validation remains present for active reference acquisition;
14. PR #105 existing-reference semantics remain present;
15. resident-evidence remains outside the registry;
16. no frontend/UI source changes;
17. isolated Neon migration validation succeeds before any production consideration.

Concurrency tests must use actual overlapping DB transactions and demonstrate both orderings:

```text
REFERENCE_FIRST -> DELETE_DENIED
DELETE_INTENT_FIRST -> REFERENCE_DENIED
```

A sequential mock that only asserts source order is insufficient evidence for this concurrency boundary.

---

## 20. Final architecture verdict

```text
BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_DESIGNED
```

Selected mechanism:

```text
DB-authoritative business_image_objects registry
+ active/delete_pending/retired lifecycle
+ short DB-only transactions
+ explicit registry-lock command before delete reference-check command
+ external Drive saga after DB commit
+ lifecycle-aware retry/reconciliation
+ fail-closed ambiguous retirement
```

Rejected mechanism:

```text
long advisory/session DB lock held across Google Drive HTTP I/O
```

Rejected implementation shortcut:

```text
unproven one-statement delete lock + reference check that may rely on a stale READ COMMITTED command snapshot
```

Next phase is a separate migration/runtime implementation lane starting from this architecture's exact accepted head.

**DRAFT / DO NOT MERGE.**
