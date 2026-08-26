# Business Image Cross-System Atomicity Architecture — 2026-08-27

Status: design-independent backend architecture decision

Refs: #106, #105, #104, #103, #102, #101, #100, #90

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

The database serializes **new reference acquisition** against **delete intent**. Google Drive is not called while a database transaction or row lock is held.

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

The Neon HTTP transaction helper is non-interactive: multiple SQL operations can be grouped, but application code cannot hold that HTTP transaction open across a Google Drive call.

A session-capable driver could technically support interactive locks, but Cloudflare/Neon connection guidance favors short transaction lifetimes and avoiding unrelated external network I/O while DB transactions are held.

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
- still require compensation if process execution dies around the external side effect;
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

A later implementation may make best-effort compensation, but safety must not depend on compensation succeeding.

---

## 7. New reference acquisition — create

PR #103 Drive validation remains first as an external-integrity check.

For an application containing a representative image, the DB persistence phase must then atomically:

```text
LOCK registry row by object_key
REQUIRE state = active
REQUIRE uploader_user_id = verified resident id
REQUIRE complex_id = canonical resident complex id
INSERT business_applications with object_key
COMMIT
```

The registry check/lock and application insert must be one PostgreSQL critical section.

Preferred implementation shape is a single SQL statement/CTE with row locking and conditional INSERT, or an equivalent short non-interactive transaction supported by the current Neon HTTP execution model.

The external Drive call is **not** inside this DB critical section.

### Idempotency

Completed idempotent replay continues to resolve before any new external Drive validation or registry reference acquisition, preserving PR #103 semantics.

No-image applications remain independent of the registry.

---

## 8. Reference replacement — changes-requested resubmit

Resubmit may replace one representative image with another.

For a replacement image, after the existing owner/state/verified-resident checks and PR #103 Drive validation, the DB mutation must atomically:

```text
LOCK new image registry row
REQUIRE new image state = active
REQUIRE new image uploader/complex binding
UPDATE application representative_image_object_key + status=pending
COMMIT
```

If implementation later introduces explicit reference-count/release rows, old-reference release and new-reference acquisition must occur in the same short DB transaction. With the current direct-reference query model, the application row itself remains the authoritative reference and delete checks observe it after commit.

No external Drive call belongs inside the DB critical section.

---

## 9. Delete-intent acquisition

Business-image delete becomes a two-stage operation.

### Stage A — database delete intent

After canonical authentication, Drive object metadata validation, and uploader mutation authorization, execute one short PostgreSQL critical section:

```text
LOCK business_image_objects row by object_key
REQUIRE uploader binding
REQUIRE state = active
CHECK protected application/business references
IF referenced:
  return 409, keep active
ELSE:
  set state = delete_pending
  set delete_requested_at
COMMIT
```

The existing PR #105 protected-reference policy remains:

- any `business_media.object_key` reference blocks delete;
- application states `draft`, `pending`, `changes_requested`, `approved` block delete;
- `rejected` is not an indefinite retention rule.

### Stage B — external Drive side effect

Only after `delete_pending` is committed:

```text
PATCH Drive file -> trashed=true
```

No new reference can be acquired while this request is in flight because every reference acquisition requires registry state `active`.

---

## 10. Serialization proof

### Case A — reference acquisition gets the registry row first

```text
CREATE/RESUBMIT
  lock active registry row
  persist application reference
  commit

DELETE
  waits for registry row
  obtains lock after commit
  sees protected reference
  returns 409
```

Result:

```text
REFERENCE committed
DELETE_INTENT denied
```

### Case B — delete gets the registry row first

```text
DELETE
  lock active registry row
  sees no protected reference
  set delete_pending
  commit

CREATE/RESUBMIT
  waits for registry row
  obtains lock after commit
  sees state != active
  reference acquisition fails closed
```

Result:

```text
DELETE_INTENT committed
NEW_REFERENCE denied
```

This closes the race without keeping a DB transaction open during Google Drive I/O.

---

## 11. Drive completion state

### Success

If Drive trash succeeds, use a new short DB update:

```text
delete_pending -> retired
retired_at = now()
```

### Failed or ambiguous Drive response

Do not restore `active` automatically.

Keep:

```text
state = delete_pending
```

and return a controlled 503-class error.

Reason: the side effect may have succeeded even if the Worker did not receive/finish processing the response. Reopening the object for new references could create a stale reference.

Safety favors an temporarily unavailable image over allowing a new reference to an ambiguously retired object.

---

## 12. Idempotent delete retry / crash recovery

DELETE behavior by registry state:

### active

Acquire delete intent normally.

### delete_pending

Do not run the normal “new delete intent” path again and do not allow new references. Reconcile/retry the Drive retirement.

If Drive proves the object already trashed or otherwise irreversibly unavailable for product use, finalize `retired`.

### retired

Return successful idempotent result such as `alreadyRetired=true`; do not call Drive unnecessarily.

This safely recovers:

- crash after `delete_pending` commit but before Drive PATCH;
- crash after Drive PATCH succeeds but before DB finalization;
- transient Drive errors;
- lost/ambiguous Drive responses.

A scheduled reconciler can later handle long-lived `delete_pending` rows, but it is not required for concurrency safety because `delete_pending` already blocks reference acquisition.

---

## 13. Approval and `business_media`

No new cross-system lock is required during approval.

Before approval, the application already contains the representative image reference. The delete-intent critical section therefore observes that protected application reference and cannot transition the registry to `delete_pending`.

PR #103 approval-time Drive revalidation remains required before approval materialization.

The approved business public API consumes `business_media.object_key`; this remains a business-image relationship under the current product write/read paths.

---

## 14. Referential-integrity recommendation

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

The concurrency guarantee comes from explicit registry state + row-lock serialization in the mutation paths. A foreign key only improves existence integrity.

Avoid trigger-based hidden lifecycle authority unless explicit bounded write paths prove insufficient.

---

## 15. Error semantics for implementation

Exact public wording can be finalized in implementation, but the semantic classes should be stable.

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

## 16. Production / rollout gate

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

Do not infer production schema parity from GitHub accepted code. Deployment must apply/validate the full migration ancestry in order.

The likely next repository migration number is 019 after 018, but this architecture document does not create migration 019.

---

## 17. Explicit non-goals

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

## 18. Implementation phase acceptance criteria

A later implementation is not complete until executable contracts prove at least:

1. business-image upload returns a key only after `active` registry registration;
2. create acquires an `active` registry row in the same DB critical section as application insert;
3. resubmit does the same for replacement reference update;
4. delete intent and reference acquisition serialize on the same object registry row;
5. referenced objects remain 409;
6. `delete_pending` rejects every new reference;
7. Drive is called only after delete intent commits;
8. Drive failure keeps `delete_pending`;
9. retry can finalize a stuck `delete_pending` object;
10. `retired` is idempotent and cannot become a new reference;
11. PR #103 owner/complex Drive validation remains present;
12. PR #105 existing-reference semantics remain present;
13. resident-evidence remains outside the registry;
14. no frontend/UI source changes;
15. isolated Neon migration validation succeeds before any production consideration.

Concurrency tests must explicitly demonstrate both ordering cases:

```text
REFERENCE_FIRST -> DELETE_DENIED
DELETE_INTENT_FIRST -> REFERENCE_DENIED
```

---

## 19. Final architecture verdict

```text
BUSINESS_IMAGE_CROSS_SYSTEM_ATOMICITY_DESIGNED
```

Selected mechanism:

```text
DB-authoritative business_image_objects registry
+ active/delete_pending/retired lifecycle
+ short row-lock critical sections
+ external Drive saga after DB commit
+ fail-closed retry/reconciliation
```

Rejected mechanism:

```text
long advisory/session DB lock held across Google Drive HTTP I/O
```

Next phase is a separate migration/runtime implementation lane starting from this architecture's exact accepted head.

**DRAFT / DO NOT MERGE.**
