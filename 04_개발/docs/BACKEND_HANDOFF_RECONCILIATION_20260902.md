# DanjiOn Backend Handoff Reconciliation — 2026-09-02

Status: `BACKEND_HANDOFF_RECONCILIATION_READY`

Authority program: #137  
Reconciliation gate: #138  
Owner/privacy decision HOLD: #139 / historical privacy gate #59

This document reconciles the 2026-09-02 Google Drive backend handoff with the current GitHub implementation. It is not permission to duplicate existing backend functionality.

## Operating rules

- GitHub code, migrations, tests and exact-head CI are implementation Source of Truth.
- Google Drive handoff is product/design authority input.
- Existing safer/canonical architecture wins over duplicate handoff scaffolding while preserving product intent.
- Owner/legal/operations decisions are isolated as HOLD and are not inferred by implementation work.
- Historical migrations are immutable; new schema changes receive the next fresh migration number.

## Current architecture

- Cloudflare Worker backend.
- Neon PostgreSQL persistence.
- Better Auth / canonical actor authentication.
- Household v2 verified-resident authorization.
- Explicit PADIEM and complex/resident-council operator RBAC.
- Google Drive business-image lifecycle with reference integrity/reconciliation controls.
- Backend CI includes typecheck/contract tests plus real PostgreSQL lifecycle/security jobs.
- Pre-Infra Integration CI and Live Release Gate remain merge gates.

## Reconciliation matrix

| Area | Classification | Current disposition / evidence |
|---|---|---|
| Phase 0 environment separation | ALREADY_IMPLEMENTED | Cloudflare development/preview/production environment contracts exist. |
| Phase 0 migrations | ALREADY_IMPLEMENTED | Normal migration chain now reaches `030_inquiries.sql`; dev-only seeds remain `900+`. |
| Phase 0 public/private storage | ALREADY_IMPLEMENTED | Storage v1/v2 + tracked business-image lifecycle and reconciliation exist. |
| Phase 0 API errors/request id | ALREADY_IMPLEMENTED | Central app/router and bounded handlers use request IDs and fail-closed error responses. |
| Phase 0 logging/audit | ALREADY_IMPLEMENTED | Audit events and admin audit surfaces exist. |
| Email/password/recovery | ALREADY_IMPLEMENTED | Better Auth plus email recovery contracts exist. |
| Social auth interface | ALREADY_IMPLEMENTED | Better Auth owns `/api/auth/*` and OAuth callbacks. |
| Consent versioning | ALREADY_IMPLEMENTED | Account lifecycle consent persistence/versioning exists. Semantic consent names may differ from handoff wording. |
| Resident verification provider/policy | BLOCKED_BY_OWNER_DECISION | Household v2 is current authorization architecture; final resident-verification provider/operating policy remains HOLD. |
| Dong/unit privacy | SUPERSEDED_BY_CURRENT_ARCHITECTURE | Household v2 uses server-side verified membership; exact residence data is excluded from public/product presentation surfaces. |
| Session/logout/reset | ALREADY_IMPLEMENTED | Auth/session and recovery paths exist. |
| Shop list/search/filter | ALREADY_IMPLEMENTED | Canonical complex-scoped business list supports query/category/relation filters and relation priority. |
| Shop detail | ALREADY_IMPLEMENTED | Canonical detail is `/api/v1/complexes/{slug}/businesses/{businessId}` with media/benefits. |
| Shop share slug | IMPLEMENTED_BUT_CONTRACT_DRIFT | Current stable detail identity is UUID. Handoff mentions `shopId/slug`; no duplicate slug system is added without a demonstrated product need. |
| Featured shops/home aggregate | IMPLEMENTED_BUT_CONTRACT_DRIFT | Current frontend maps live business data into the home visual shell. No duplicate `/api/home` aggregate has been introduced. |
| Bookmarks/save | ALREADY_IMPLEMENTED | Existing bookmark list/add/delete endpoints exist. |
| Benefits | ALREADY_IMPLEMENTED | Complex/business benefit reads and resident benefit authorization paths exist. |
| Shop reviews | ALREADY_IMPLEMENTED | #152 / PR #153 added text-only resident reviews under canonical complex/business routes. |
| Shop owner replies | ALREADY_IMPLEMENTED | #152 / PR #153 added one canonical owner reply per review with DB-level owner enforcement. |
| Owner business application | ALREADY_IMPLEMENTED | Resident economy v2 plus application/review lifecycle exists. |
| Business image upload | ALREADY_IMPLEMENTED | Tracked upload, lifecycle registry, reference integrity and background reconciliation exist. |
| Private proof-document model | BLOCKED_BY_OWNER_DECISION | Handoff fixes private visibility and at least one operating-proof document for owner applications, but explicitly says per-file max MB is not decided and backend must not invent it. Existing `resident-evidence` storage is a different HOLD-bound domain and must not be repurposed silently. |
| Neighbor/family shop recommendation | ALREADY_IMPLEMENTED | #159 / PR #161 adds a non-owner recommendation lane. Approval materializes an unowned canonical business and verified complex relation; reporter is never asserted as owner. |
| Business approval workflow | ALREADY_IMPLEMENTED | Admin operational handler approves/requests changes/rejects owner applications; shop recommendations reuse the same business-review RBAC with separate non-owner semantics. |
| Official notices/content | ALREADY_IMPLEMENTED | `complex_posts` remains trusted/official content storage. |
| Apartment news vs notice semantics | IMPLEMENTED_BUT_CONTRACT_DRIFT | Official content shares `complex_posts`; final guest visibility for apartment news remains owner-policy sensitive. |
| Resident news submission/review | IMPLEMENTED_BUT_CONTRACT_DRIFT | Community supports resident-authored content and moderation, but handoff’s distinct resident-news product lane is not a separate canonical table/API. |
| Community posts CRUD | ALREADY_IMPLEMENTED | Resident-only Community persistence/API exists. |
| Community comments | ALREADY_IMPLEMENTED | Comments exist with create/read/update/delete/moderation boundaries. |
| Community nested replies | ALREADY_IMPLEMENTED | #155 / PR #156 adds `parent_comment_id` on canonical `community_comments`; replies reuse existing reporting/moderation and same publish-mode semantics. |
| Community reactions | ALREADY_IMPLEMENTED | Like reaction persistence/API exists. |
| Community reports/moderation | ALREADY_IMPLEMENTED | Reports, moderation events and operator flows exist. |
| My summary | IMPLEMENTED_BUT_CONTRACT_DRIFT | Multiple `/me` product surfaces exist; one handoff-shaped aggregate summary is not canonicalized. |
| Resident conversations/messages | ALREADY_IMPLEMENTED | #140 / PR #147 added complex-scoped verified-resident 1:1 conversations/messages plus block enforcement. |
| Notifications | ALREADY_IMPLEMENTED | #148 / PR #149 added notification persistence/list/read/read-all and atomic message notification production. |
| Public resident profile | ALREADY_IMPLEMENTED | #150 / PR #151 added safe same-complex verified-resident profile reads and self-edit; exact residence/provider PII is excluded. |
| Warmth score | BLOCKED_BY_OWNER_DECISION | Event-based direction is known, but score weights/formula and penalty rules are explicitly not approved. |
| Activity surface | MISSING_IMPLEMENTATION | No dedicated resident activity API exists. Scope must reuse existing domain data rather than duplicate content. |
| Household members/invites | ALREADY_IMPLEMENTED | Household v2 master/claim/family lifecycle exists. |
| Third household member evidence policy | BLOCKED_BY_OWNER_DECISION | Final proof/review rule remains HOLD. |
| Generic blocks API | ALREADY_IMPLEMENTED | #157 / PR #158 exposes resident block/list/unblock controls on the existing canonical `blocks` table; messaging/profile safety continues consuming the same relation. |
| Settings | MISSING_IMPLEMENTATION | No canonical backend settings/preferences surface is confirmed. Notification/marketing consent semantics must not be duplicated when implementing it. |
| Inquiries/support | IMPLEMENTED_BUT_CONTRACT_DRIFT | #162 implements resident inquiry core, operator status/response and idempotent answer notification. Handoff-required photo attachment remains HOLD with the unresolved private-file max-MB decision. |
| Product-account closure | ALREADY_IMPLEMENTED | Product account close revokes grants/memberships/invites, anonymizes presentation identity and writes audit evidence. |
| Auth-provider credential deletion | IMPLEMENTED_BUT_CONTRACT_DRIFT | Product account close explicitly does not delete provider credentials; provider deletion is a separate boundary. |
| Admin/operator RBAC | SUPERSEDED_BY_CURRENT_ARCHITECTURE | Generic handoff `ADMIN` wording is superseded by explicit PADIEM + complex/resident-council scopes. |
| Verification/admin review | ALREADY_IMPLEMENTED | Admin verification/review-context/operational handlers exist. |
| Audit logs | ALREADY_IMPLEMENTED | Admin audit + authorization audit infrastructure exists. |

## Newly completed implementation slices

### Resident messaging
- Issue #140 / PR #147.
- Migration `024_resident_messages.sql`.
- Verified-resident 1:1 conversations/messages; block relationship checks; no exact residence/provider PII.

### Resident notifications
- Issue #148 / PR #149.
- Migration `025_resident_notifications.sql`.
- List/unread/read/read-all; message insert creates recipient notification transactionally without copying message body.

### Safe resident public profile
- Issue #150 / PR #151.
- Migration `026_resident_public_profiles.sql`.
- Same-complex verified-resident access, bounded public bio, blocked relationship hiding, no exact residence/provider evidence.

### Shop reviews and owner replies
- Issue #152 / PR #153.
- Migration `027_business_reviews.sql`.
- Text-only resident reviews and canonical owner reply with DB-level owner enforcement.

### Community nested comment replies
- Issue #155 / PR #156.
- Migration `028_community_comment_replies.sql`.
- Canonical comments gain parent relation; same post/complex FK and existing moderation/reporting reused.

### Resident block management
- Issue #157 / PR #158.
- Reuses `blocks` from migration 024; list/create/remove with same-complex verified-target creation checks.

### Non-owner shop recommendations
- Issue #159 / PR #161.
- Migration `029_shop_recommendations.sql`.
- Verified resident recommendation lane; approval materializes `owner_user_id = null` business and verified relation; owner application semantics remain unchanged.

### Resident inquiry core
- Issue #162.
- Migration `030_inquiries.sql`.
- Verified residents can create/list/read their own inquiries and close answered inquiries.
- Status lifecycle: `received -> in_progress -> answered -> closed` with DB constraints preventing answered/closed states without a response.
- Operator queue/response uses explicit `inquiry.respond` / `council.inquiry.respond` operational scopes; no grants are auto-created.
- Answer creates an idempotent resident notification without copying inquiry body or response text.
- Photo attachment remains outside this slice until private-file size policy is owner-approved.
- Dedicated PostgreSQL 18 lifecycle validates state constraints, answer notification idempotency and no private-text copy.

## Owner / legal / operations HOLD
Do not infer or implement these decisions:

1. Final resident-verification provider/mechanism.
2. Resident-code issuance/loss/reissue/move-out/change operating policy.
3. Personal-data controller / processor / third-party handling conclusion.
4. Final file-per-upload MB limit, including owner proof documents and inquiry attachments.
5. Guest visibility depth for apartment news.
6. Guest visibility depth for exact resident-benefit details.
7. Definition of “benefits received” count.
8. Existing-content disposition after product-account deletion.
9. Required evidence for third household member approval.
10. Separate signup/identity/claim flow for nonresident family or external shop owners.
11. Warmth score formula/event weights/penalty rules.

## Frontend integration status

Classification: `IMPLEMENTED_BUT_CONTRACT_DRIFT`

The frontend contains both real API adapters/live-data integration and mock/demo stores. Therefore mock files must not be blanket-deleted. Remaining work is route-by-route replacement of production-critical mock/session state authority with current APIs while preserving the approved visual shell.

Known real integration surfaces include auth, Community, admin/operations review, verification, storage, and V2 live business data.

Known remaining risk: demo/mock stores still coexist in frontend source and require production-route reconciliation rather than global deletion.

## Ranked non-HOLD next work

1. Settings/preferences backend surface limited to decision-free preferences and canonical consent reuse.
2. Activity API derived from existing domain data.
3. Frontend production-route API reconciliation and E2E replacement of remaining mock/session authority.

## Current verdict

`BACKEND_HANDOFF_RECONCILIATION_READY`

The repository is not a greenfield backend. The correct execution model remains:

`fresh main -> reconcile -> smallest non-HOLD gap -> migration/API/tests -> real PostgreSQL gate where applicable -> exact-head CI -> squash merge -> next gap`
