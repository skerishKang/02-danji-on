# Community C6 Security / E2E — CURRENT 2026-08-30

Issue: #45

## Evidence model

C6 does not pretend that one test layer proves every boundary. Acceptance combines three independent layers:

1. **Synthetic authorization tests** (`authorization-v2.test.mjs`, `operational-authz-v2.test.mjs`)
   - A/B verified in complex-1
   - C verified only in complex-2 and rejected for complex-1
   - D authenticated but unverified and rejected
   - O explicit PADIEM operator
   - legacy manager/support identities do not inherit operator authority
2. **Real PostgreSQL Community lifecycle** (`community-postgres-security.sh`)
   - real PostgreSQL 18 with migrations `001` + `013`
   - A complex-1 post and B same-complex comment persist
   - C complex-2 rows remain outside complex-1 feed
   - cross-complex comment/reaction composite FKs reject invalid tenant links
   - owner-scoped mutation query does not update another resident's row
   - reaction add is idempotent
   - duplicate open report is rejected by the partial unique index
   - report remains in the submitted operator queue state
   - hide -> restore writes immutable moderation event rows
   - official `complex_posts` and resident `community_posts` remain physically separate
3. **CURRENT Product Shell contract and existing Playwright regression**
   - resident Community uses authenticated `/community/*` API paths
   - official content continues through public `/posts`
   - 401/403 keeps the Community surface locked
   - server publication state controls pending/published UI
   - React does not use `dangerouslySetInnerHTML` / raw `innerHTML` for resident content
   - CURRENT mock-mode Playwright suite remains green for visual/product regression

## Issue #45 C6 mapping

| Required gate | Evidence |
| --- | --- |
| A writes -> B reads/comments | real PostgreSQL A post + B same-complex comment; resident API static contract uses same scoped tables |
| cross-complex read/write denied | Household-v2 synthetic C denial + PostgreSQL composite FK/complex-scoped feed checks |
| unverified/non-auth denied | authorization-v2 synthetic D denial + shared auth boundary contract |
| reaction idempotency | PostgreSQL unique constraint + API `ON CONFLICT DO NOTHING` contract |
| report -> operator queue | PostgreSQL submitted report + moderation queue/static authority contract |
| hide/restore audit | PostgreSQL state transition + two immutable moderation events |
| other resident PATCH/DELETE denied | owner-scoped SQL contract + PostgreSQL wrong-owner update affects no row |
| public `/posts` resident leak absent | C6A core route contract + PostgreSQL table separation probe |
| executable XSS rendering absent | C5 Product Shell contract rejects raw HTML rendering APIs |

## Boundaries

- no production DB mutation
- no production deploy
- no real resident data
- all database probes run against disposable GitHub Actions PostgreSQL
- Issue #59 privacy/provider HOLD remains unchanged
- Community media C7 remains optional and does not block text-first Community completion

Expected verdict after exact-head CI:

`COMMUNITY_C6_SECURITY_E2E_LAYERED_GREEN`
