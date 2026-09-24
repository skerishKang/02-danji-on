# OPS Reliability Runbook v1 — Backup / Recovery / Alerting Baseline

Issue: #695 · PHASE=READ_ONLY_INVENTORY_AND_RUNBOOK · PRODUCTION_MUTATION=0
Status: inventory baseline completed 2026-09-18 (main 3773a2c). Operational backup state updated 2026-09-23: the first real encrypted Production logical backup completed successfully in run `35836417391`; Production DB writes remained 0. The isolated non-Production restore drill is still not executed and remains separately owner-gated.

## 1. Scope and authority

- This runbook documents, it does **not** mutate. Production database restore/delete/branch operations, Worker/Pages deployments, and secret changes require separate explicit owner approval.
- Owner of this runbook: CTO agent proposes, human owner approves any mutation-class change.
- `PRODUCTION_MUTATION=0` for the entire lifecycle of this document until a separate implementation issue is approved.

## 2. Inventory — repository-observable facts (verified 2026-09-18, main 3773a2c)

### 2.1 Application / backend

| Fact | Evidence |
|---|---|
| API runtime | Cloudflare Worker, same-origin `/api` (`04_개발/backend/README.md`) |
| Database | Neon PostgreSQL |
| Health endpoint | `GET /api/health` — runs `select 1 as ok`, returns `{status:'ok', database:'ok'}` (`04_개발/backend/src/core-v1.ts:80`) |
| Release provenance | `04_개발/backend/scripts/deploy-provenance.mjs` (Issue #384): captures Worker version ID, source SHA, digest from wrangler deploy output; fails closed; never serializes secrets |
| Release gates | `04_개발/docs/LIVE_INTEGRATION_RELEASE_GATE_v1.md`; production migration gate `04_개발/backend/scripts/production-migration-gate.mjs` |
| Pages deploy path | `.github/workflows/pages-production-release.yml` — `workflow_dispatch` only, requires `confirm_production` |
| Review deploy path | `.github/workflows/danjion-review-auto-deploy.yml` — main push, isolated `danjion-review` Pages project, never production |

### 2.2 Inventory-time gaps and current disposition

The bullets below were true at the 2026-09-18 inventory baseline. Current status is recorded inline so the historical audit remains readable without presenting superseded facts as current.

- Continuous uptime / error-rate alerting remains incomplete beyond release-time and bounded monitoring checks.
- Database availability/error observability remains incomplete; #950 tracks sanitized 503-class availability classification.
- Backup authority and encrypted logical-backup execution are now implemented under #714. First real Production backup run `35836417391` passed on 2026-09-23.
- Restore procedure source exists and was hardened by PR #942, but the isolated non-Production restore drill has **not** run and remains separately owner-gated.
- Incident severity/owner/evidence-retention contract is documented in §6 below.

## 3. Inventory — provider facts (verified read-only 2026-09-18 via provider consoles)

These must be read from provider consoles/CLI by the owner (or an agent with approved read-only provider access). Do **not** assume plan defaults equal accepted policy.

### 3.1 Neon (Production database)

Verification procedure (read-only):

1. `npx neonctl auth` using an approved account, then `npx neonctl projects list` to identify the production project.
2. `npx neonctl branches list --project <id>` — record existing branches and whether history retention (PITR window) is visible.
3. Console → Project → Backup & restore: record plan-included backup/PITR retention window and restore surface (restore-to-branch, restore-to-project).
4. Record the retention/window facts verbatim in the table below. Never copy connection strings, passwords, or roles into this document.

| Item | Value (verified 2026-09-18) |
|---|---|
| Neon plan / region | **Free plan**, AWS Asia Pacific 1 (Singapore) |
| Production project | `Danjion` — ID `old-shape-61609481`, default branch `production` (`br-bold-sun-azurylwi`, created 2026-08-08) |
| Compute | 0.25 ↔ 2 CU autoscaling (default compute) |
| **History retention (PITR window)** | **6 hours** — point-in-time recovery is impossible beyond 6 hours ago on current settings |
| Backup capability included | Neon history/PITR only; no separate scheduled snapshots included on Free plan |
| Restore surface | Branch-level restore / child branches (used 4/10) — restore-to-branch available; production-like drill must target a child branch, never overwrite `production` |
| Separate scheduled snapshot required? | **YES — likely required**: 6h PITR window is below any reasonable RPO for identity/audit data; upgrade or scheduled logical dumps are the candidate mitigations (see §10) |
| Branch hygiene note | 3 stale sandbox/preview branches (`better-auth-five-method-sandbox-20260826`, `cloudflare-preview-20260808`, `pre-danjion-schema-20260808`) consume branch quota; cleanup is owner-approved housekeeping, not this issue |

QA reference: project `Danjion-QA` — ID `wispy-rain-16787448`, branch `qa-main`, Free plan, history retention 6 hours.

### 3.2 Cloudflare (Worker / Pages)

Verification procedure (read-only):

1. Dashboard → Workers → `padiem-danjion-api` (production): record existing notification/alert settings.
2. Dashboard → Pages → `danjion`: same.
3. Check whether any external uptime monitor already watches the domains.

| Item | Value (verified 2026-09-18) |
|---|---|
| Existing Worker alerting | **None** — account notifications table is empty (Padiem account `5a305a…41d`) |
| Existing Pages alerting | **None** — same account-level notifications surface |
| External uptime monitor | None known; only release-time checks inside CI |

## 4. Data classification for recovery guarantees

Classify datasets beyond provider defaults; never copy customer PII into test fixtures.

| Class | Data | Recovery expectation |
|---|---|---|
| Identity/auth | better-auth users, sessions, accounts | Highest — recovery priority 1 |
| Authorization | admin principals, grants, scopes | Highest — recovery priority 1 |
| Audit | global audit events, admin audit | Highest — append-only, must survive restore |
| Resident product data | profiles, households, applications, notifications | High — recovery priority 2 |
| Community / business | posts, reviews, inquiries, moderation | High — recovery priority 2 |
| Derived/cache-like | counters, rate-limit buckets | Low — may be rebuilt |

## 5. Recovery drill design (non-production, read-only toward Production)

Bounded exercise, executed only after a separate approval:

1. Export nothing from Production. Instead restore a provider backup/PITR candidate into a **private, access-controlled non-production branch/project**.
2. Verify: schema/migration compatibility (`select version from migrations order by version desc limit 1` equivalent matches production migration state), row counts by table class (aggregates only), basic read smoke (`/api/health` style, a public read).
3. Record: restore start/end time (proves RTO feasibility), restored LSN/timestamp (proves RPO point), anomalies.
4. Tear down the drill branch afterwards. Never expose the drill environment publicly; never restore Production data into a shared/public environment.

## 6. Incident runbook (minimum safe evidence)

On any production incident, capture exactly:

- release SHA (main), Worker version ID, Pages release ID (from deploy provenance artifacts);
- `GET /api/health` status and timestamp;
- migration state (latest applied version only);
- error code aggregates (counts by code, e.g. `AUTH_...`, `VALIDATION_...`) — codes only, no payloads.

Prohibited in incident logs: tokens, DB URLs, cookies, auth payloads, raw customer PII, session material. Values are replaced by `[값]`; structure is preserved (same logging rule as QA log analysis).

Severity / owner / retention:

| Severity | Meaning | Owner | Evidence retention |
|---|---|---|---|
| S1 | Production unreachable or data-affecting | Human owner + CTO agent | Until postmortem closed + 30 days |
| S2 | Degraded (health ok, surface errors) | CTO agent | Until fixed + 14 days |
| S3 | Cosmetic / single-user | CTO agent | Issue trail |

## 7. RPO / RTO targets

| Metric | Target |
|---|---|
| RPO | Current platform PITR window remains **6 hours**. The encrypted logical-backup workflow is now source-armed and enabled through the Production environment variable `DANJION_BACKUP_ENABLED=enabled`; first real Production backup run `35836417391` passed. The scheduled cadence is once daily (**24h candidate RPO**) with 30 encrypted generations retained. The formal owner-approved RPO target is still pending final recovery-policy closure. |
| RTO | Owner decision required. Candidate inputs: isolated restore-drill time (§5) + Worker deploy time. The restore drill has not run yet. |

The backup mechanism is active; the formal RPO/RTO policy remains open until the isolated restore drill supplies measured recovery evidence.

## 8. Rollback vs restore decision boundary

- **Rollback (code)**: deploy previous Worker version / Pages release. No data involved. Owner-approved deploy action. Use when a release is broken and the schema is compatible (forward-compatible migrations only, per migration gate).
- **Restore (data)**: recover database from backup/PITR. Destructive to post-backup data. Separate explicit owner approval, never bundled with a code rollback.
- If both are needed: **data restore first, code rollback second**, with the data decision recorded in the incident trail.

## 9. Who may execute Production recovery mutations

- Production DB restore/branch mutation: human owner only, via provider console under their own credentials.
- CTO agent may prepare commands/docs but must not execute them.
- Worker/Pages deploys: only via the existing approval-gated workflows (`pages-production-release` requires `confirm_production`).
- All executions produce evidence per §6.

## 10. Follow-up implementation issues (separate approval gates)

1. **Backup hardening** — #714 / source child #793. Scheduled encrypted PostgreSQL custom-format logical dump to a dedicated Google Drive folder, once daily (24h candidate RPO), retention 30 encrypted generations. Activation now uses the Production environment variable `DANJION_BACKUP_ENABLED=enabled` together with explicit production/Drive/encryption secret bindings. No plaintext dump may leave the runner; no GitHub backup artifact is permitted. **Status: source implementation complete; activation completed; first real Production backup run `35836417391` PASS.**
2. **Uptime/error alerting** — add Cloudflare account notifications (or external monitor) for Worker + Pages health. (Enabled by §3.2 facts — none configured today.)
3. **Recovery drill execution** — restore one encrypted logical backup candidate into an isolated private non-production target, verify schema/aggregates/read-smoke, record RTO evidence, and tear down. **The source-ready drill is `verify-neon-backup-restore.yml`; PR #942 hardened its activation output contract. It remains dispatch-only with `DANJION_RESTORE_SOURCE_ARMED=false`. Execution is separately owner-gated and requires a later arm change, Production environment variable `DANJION_BACKUP_RESTORE_DRILL_ENABLED=enabled`, and an owner-provisioned isolated drill target. Production and shared QA are forbidden restore targets.**

   The active drill additionally requires the later owner binding `DANJION_RESTORE_APPROVED_TARGET_SHA256`. The source computes a SHA-256 fingerprint over a credential-redacted, canonicalized PostgreSQL target URL (userinfo removed; non-credential query parameters sorted) and rejects missing, malformed, or mismatched identities before Drive, plaintext, or database operations. A standard Neon connection URL exposes an endpoint hostname, not a reliable provider project ID, so the owner/CENTRAL must separately read back and approve the exact isolated project/branch before setting this binding. The binding value and target URL must never be committed or printed.
4. **RPO/RTO confirmation** — record owner-approved targets after drill results.
5. **Branch hygiene** (housekeeping, low priority) — owner-approved cleanup of the 3 stale sandbox branches.


## 11. Logical backup activation boundary (#714 / #793)

The backup source is intentionally separable from activation.

Source contract:

```text
NEON_ORG=Padiem
PRODUCTION_PROJECT=Danjion
PRODUCTION_PROJECT_ID=old-shape-61609481
BACKUP_FORMAT=pg_dump custom
ENCRYPTION=GPG AES256 symmetric
CANDIDATE_RPO=24h
RETENTION_GENERATIONS=30
DESTINATION=dedicated Google Drive folder via owner OAuth rclone config
```

Current activation contract:

- repository source arm: `DANJION_BACKUP_SOURCE_ARMED=true`
- Production environment variable: `DANJION_BACKUP_ENABLED=enabled`
- existing `DANJION_PRODUCTION_DB_URL` Production environment secret
- `DANJION_BACKUP_ENCRYPTION_PASSPHRASE`
- `DANJION_DRIVE_RCLONE_CONFIG` (owner-authorized rclone OAuth config for Google Drive)
- `DANJION_DRIVE_FOLDER_ID`
- obsolete secret named `DANJION_BACKUP_ENABLED`: absent after the activation fix

Safety boundaries:

- scheduled workflow is a no-op unless **both** the source arm is `true` and the Production environment variable equals the exact token `enabled`;
- Production database access is dump/read only;
- the dump session sets `default_transaction_read_only=on`;
- plaintext dump is destroyed before the rclone OAuth config is materialized and before any upload;
- only the encrypted `.dump.gpg` object is uploaded;
- retention deletion is restricted to the exact `danjion-prod-<UTC>-<sha>.dump.gpg` filename family;
- database material is never uploaded as a GitHub Actions artifact;
- restore verification remains a separate explicit mutation gate and must target a private non-production restore surface, never the shared QA environment by default.


Service-account note: Google documents that service accounts do not have Drive storage quota and cannot own ordinary Drive files. Therefore the free-path implementation uses an owner-authorized OAuth/rclone configuration for ordinary My Drive. A service-account variant is appropriate only when the destination is a supported Shared Drive or another ownership model explicitly designed for it.

## 12. Current #714 disposition

Superseding operational state as of 2026-09-23:

```text
SOURCE_IMPLEMENTATION=#793 CLOSED_COMPLETED
BACKUP_SOURCE_ARMED=true
BACKUP_ENABLE_CONTEXT=vars.DANJION_BACKUP_ENABLED
BACKUP_ENABLE_TOKEN=enabled
FIRST_REAL_PRODUCTION_BACKUP=PASS
BACKUP_RUN_ID=35836417391
BACKUP_RUN_ATTEMPT=1
BACKUP_HEAD=47589a80667cb329e8fb0d903eacbbe71bd2b007
BACKUP_RESULT=PASS
DUMP_BYTES=454294
ENCRYPTED_BYTES=165412
PRODUCTION_DB_WRITE=0
AUTO_RETRY=0
SECRET_EXPOSURE=NO

RESTORE_GATE_HARDENING=#942 MERGED
DANJION_RESTORE_SOURCE_ARMED=false
RESTORE_EXECUTION=0
PRODUCTION_RESTORE=FORBIDDEN
SHARED_QA_RESTORE=FORBIDDEN

NEXT_GATE=ISOLATED_RESTORE_TARGET_AND_ACTIVATION_READINESS_REVIEW
```

The successful first backup proves the encrypted logical-backup path can read Production without writing to it, encrypt the dump, destroy plaintext, upload the encrypted object to the bounded Drive destination, and read the object back. It does **not** prove restore readiness or RTO.

The remaining #714 operational gate is an explicitly approved isolated non-Production restore drill. Before execution, CENTRAL/owner must review the isolated target, source-arm change, `DANJION_BACKUP_RESTORE_DRILL_ENABLED=enabled` variable, exact backup filename, teardown plan, and readback criteria. Production and shared QA remain forbidden targets.

No paid Neon plan change is implied or authorized by this runbook.
