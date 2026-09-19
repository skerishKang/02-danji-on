# OPS Reliability Runbook v1 — Backup / Recovery / Alerting Baseline

Issue: #695 · PHASE=READ_ONLY_INVENTORY_AND_RUNBOOK · PRODUCTION_MUTATION=0
Status: inventory complete 2026-09-18 (main 3773a2c). Provider facts verified read-only via provider consoles (Neon console, Cloudflare dashboard). No mutation performed.

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

### 2.2 What does NOT exist yet (gap confirmed)

- No continuous uptime / error-rate alerting (release-time checks only).
- No database availability/error alerting.
- No documented backup authority, retention, restore procedure, or recovery drill.
- No incident severity/owner/evidence-retention contract.

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
| RPO | Current platform PITR window: **6 hours**. Source-ready candidate mitigation: encrypted logical dump to Google Drive once daily (**24h candidate RPO**), retaining 30 generations. Activation remains owner-gated under #714/#793; this document does not assert the schedule is live. |
| RTO | Owner decision required. Candidate inputs: branch-restore time (drill, §5) + Worker deploy time |

Both require owner confirmation; the drill (§5) is the measurement instrument.

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

1. **Backup hardening** — #714 / source child #793. Source path: scheduled encrypted PostgreSQL custom-format logical dump to a dedicated Google Drive folder, candidate cadence once daily (24h), retention 30 encrypted generations. The merged source must remain fail-closed unless `DANJION_BACKUP_ENABLED=true` and all required production/Drive/encryption secret bindings are explicitly provisioned. No plaintext dump may leave the runner; no GitHub backup artifact is permitted. **Status: source implementation in progress; activation pending owner approval and credential provisioning.**
2. **Uptime/error alerting** — add Cloudflare account notifications (or external monitor) for Worker + Pages health. (Enabled by §3.2 facts — none configured today.)
3. **Recovery drill execution** — restore PITR candidate into a private child branch, verify schema/aggregates/read-smoke, record RTO evidence, tear down.
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

Activation prerequisites are owner-controlled and are not created by repository code:

- `DANJION_BACKUP_ENABLED=true`
- existing `DANJION_PRODUCTION_DB_URL` production environment secret
- `DANJION_BACKUP_ENCRYPTION_PASSPHRASE`
- `DANJION_DRIVE_RCLONE_CONFIG` (owner-authorized rclone OAuth config for Google Drive)
- `DANJION_DRIVE_FOLDER_ID`

Safety boundaries:

- scheduled workflow is a no-op while the enable secret is absent/not exactly `true`;
- Production database access is dump/read only;
- the dump session sets `default_transaction_read_only=on`;
- plaintext dump is destroyed before the rclone OAuth config is materialized and before any upload;
- only the encrypted `.dump.gpg` object is uploaded;
- retention deletion is restricted to the exact `danjion-prod-<UTC>-<sha>.dump.gpg` filename family;
- database material is never uploaded as a GitHub Actions artifact;
- restore verification remains a separate explicit mutation gate and must target a private non-production restore surface, never the shared QA environment by default.


Service-account note: Google documents that service accounts do not have Drive storage quota and cannot own ordinary Drive files. Therefore the free-path implementation uses an owner-authorized OAuth/rclone configuration for ordinary My Drive. A service-account variant is appropriate only when the destination is a supported Shared Drive or another ownership model explicitly designed for it.
