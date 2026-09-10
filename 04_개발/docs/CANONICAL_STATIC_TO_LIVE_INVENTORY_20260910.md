# CANONICAL_STATIC_TO_LIVE_INVENTORY — KILO1 #316 Phase 1 (Reconciliation at current main)

READ-ONLY audit. FRESH_MAIN_SHA=b70f81533f96e46d765750f56b10c0f34e7aabc0 (merge-forward 46c3cfc→72ad623→b70f815; #340/#331 resident, #342 CI gate, #344/#329 C1 community, #345/#341 owner-relation merges folded in; audit is classified against the true fresh head).
Authority: this reconciliation supersedes the accepted #318 matrix (b4b50a1) where merged leaves changed surface state. No source, backend, schema, migration, or production changes.

## Legend
- LIVE_SERVER = page wired to real API via bridge; server mode is the primary path (demo path may still exist behind empty apiBase)
- HYBRID_SAFE_FALLBACK = real API path + explicit demo/mock fallback with first-paint mock
- DEMO_ONLY = comparison/review/harness artifact, no server intent
- DISCONNECTED = canonical user surface; backend authority exists; page makes zero API calls
- POLICY_HOLD = owner-decision gate (#59/#139/#235/#253/#263) blocks wiring

## Classification deltas since #318 (accepted at b4b50a1)
| Surface | #318 class | Class @b70f815 | Delta reason |
|---|---|---|---|
| index3.html | DISCONNECTED | LIVE_SERVER (server mode) | #324 session runtime + #333/#338 auth wiring merged |
| 26_우리집연결.html | DISCONNECTED | LIVE_SERVER (server mode) | #336 household-claim-bridge merged |
| 06/07/08/09 news | DISCONNECTED | HYBRID_SAFE_FALLBACK | #335 danjion-news-bridge wired; public GET, no session needed |
| 20/21/27 messages+notif | DISCONNECTED | HYBRID_SAFE_FALLBACK | #337 messages-notifications-bridge wired (DanjionSession) |
| 25A_신청제보.html | HYBRID(owner)/DEMO(report) | HYBRID_SAFE_FALLBACK (both lanes; owner lane now relation-resolving) | #309 report lane + #314 owner gallery merged; #345/#341 added raw-preservation relation resolution + fail-closed approval via application-report-bridge relations capability |
| 19/22/24/28 profile+settings+activity | DISCONNECTED | HYBRID_SAFE_FALLBACK | #340 resident-bridge.js wired, serverConfig apiBase gate, demo-guard fallback |
| 25_1대1문의.html | DISCONNECTED | HYBRID_SAFE_FALLBACK | #340 inquiry-bridge wired, `if(!API_BASE)return` demo guard |
| 12/13/15/16/17 community | DISCONNECTED | HYBRID_SAFE_FALLBACK | #344/#329 C1 community-bridge.js wired (DanjionSession.danjionApiBase gate, `if(!apiBase)return` demo guard, kind map story/question/together) |
| 14_가입인사_글쓰기 | DISCONNECTED | DISCONNECTED (leaf #329 C2 OPEN) | greeting kind contract + migration 047 still pending |
| 01_이웃가게_발견_v3 | HYBRID_SAFE_FALLBACK | HYBRID_SAFE_FALLBACK | unchanged |
| 23/07-warmth | POLICY_HOLD | POLICY_HOLD (#263) | unchanged |
| 03 coupons mode display | POLICY_HOLD(#253/#139) | POLICY_HOLD | unchanged |
| 02/04/05/10/11 | DISCONNECTED | DISCONNECTED | unchanged; 10/11 owned by resident-news leaf (see overlap) |

## Reconciled matrix (39 canonical files @b70f815)
| # | File | Class | Bridge/runtime | Backend authority | Blocking/dependency | Lane overlap | Next leaf |
|---|---|---|---|---|---|---|---|
| 1 | index3.html | LIVE_SERVER | danjion-session.js (#324) | signup-contact-verification-v1, verified-signup-v1, auth-better-v1 | none — merged #338 | #325 CLOSED | none (done) |
| 2 | 26_우리집연결.html | LIVE_SERVER | household-claim-bridge.js + danjion-session (#336) | household-claim-v2, household-family-v2, household-master-v2 | none — merged #336 | #328 CLOSED | none (done) |
| 3 | 01_이웃가게_발견_v3.html | HYBRID_SAFE_FALLBACK | saved-shops/reviews/benefit-claim/inquiry/application-report bridges | core-v1 businesses, bookmarks, reviews, benefit-wallet, inquiries | apiBase injection at deploy/link time | L12 (unassigned; #321 train) | candidate leaf under #321 |
| 4 | 25A_신청제보.html | HYBRID_SAFE_FALLBACK | application-report-bridge.js (#309,#314) | resident-economy-v2 applications; shop-recommendations-v1 | none — both lanes merged | #327 OPEN (B4 completion: private docs read-back) | #327 |
| 5 | 06_단지온공지_목록.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) | core-v1 GET /posts?channel=danjion_notice (public) | none — merged | #326 CLOSED | none (done) |
| 6 | 07_단지온공지_상세.html | HYBRID_SAFE_FALLBACK (+warmth copy HOLD) | danjion-news-bridge (#335) | core-v1 public posts | L11 copy scrub still blocked by #263 | #326 CLOSED; L11 unassigned | copy scrub leaf (pending #263) |
| 7 | 08_아파트소식_목록.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) | core-v1 public posts | none — merged | #326 CLOSED | none (done) |
| 8 | 09_회장인사_상세.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) | core-v1 public posts | none — merged | #326 CLOSED | none (done) |
| 9 | 20_메시지함_목록.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-messages-v1 | none — merged | #330 CLOSED | none (done) |
| 10 | 21_메시지_대화상세.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-messages-v1 | none — merged | #330 CLOSED | none (done) |
| 11 | 27_알림함.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-notifications-v1 | none — merged | #330 CLOSED | none (done) |
| 12 | 12_이웃대화_첫화면.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344/#329 C1) | community-resident-v1 GET /community/posts (kind map resident_story/question/together) | none — merged #344 | #329 C1 DONE (PR #344); C2 pending | none (C1 done) |
| 13 | 13_이웃대화_글상세_댓글.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 detail + community-replies-v1 | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 14 | 14_가입인사_글쓰기.html | DISCONNECTED | none | needs kind='greeting' (migration 047) | server kind contract + migration 047 | #329 C2 — ACTIVE LANE | #329 C2 (migration 047) |
| 15 | 15_단지이야기_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST resident_story | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 16 | 16_궁금해요_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST question | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 17 | 17_같이해요_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST together | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 18 | 19_내정보_메인.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | core-v1 /me; resident-summary-v1 | none — merged #340 | #331 CLOSED (PR #340) | none (done) |
| 19 | 22_주민_공개프로필.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | resident-profile-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 20 | 24_설정.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | resident-settings-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 21 | 28_나의활동.html | HYBRID_SAFE_FALLBACK | resident-bridge.js + activity-28.js local render (#340) | resident-activity-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 22 | 25_1대1문의.html | HYBRID_SAFE_FALLBACK | inquiry-bridge.js reuse (#340; signature unchanged) | inquiries-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 23 | 10_주민소식_목록.html | DISCONNECTED | none | resident-news-v1 (verified) | wiring + session | unassigned (#321/#329 adjacent; resident-news-v1 ≠ community-resident-v1) | new leaf (see rec #1) |
| 24 | 11_주민소식_상세.html | DISCONNECTED | consistency.js only | resident-news-v1 detail | wiring + session | unassigned | new leaf (see rec #1) |
| 25 | 02_이웃가게_상세.html | DISCONNECTED | none; hardcoded SHOPS | core-v1 businesses/:id + reviews | superseded by 01v3 in B mode; wire only if A-mode survives | none | hold as artifact (see rec #4) |
| 26 | 03_주민혜택_쿠폰.html | POLICY_HOLD | consistency.js | core-v1 /benefits + benefit-wallet-v1 | delivery-mode display #253/#139 | none | hold (#253/#139) |
| 27 | 03_주민혜택_쿠폰_v2.html | DEMO_ONLY | consistency.js | — | comparison artifact | none | none |
| 28 | 23_이웃온기.html | POLICY_HOLD | none | NONE (no backend warmth) | #263 BLOCKED_BY_OWNER_DECISION; copy violates HOLD | none | copy scrub leaf only (pending #263) |
| 29 | 04_데일리홈.html | DISCONNECTED | none; localStorage savedShops | businesses public + bookmarks | wiring | unassigned | candidate leaf under #321 (rec #2) |
| 30 | 05_우리단지_첫화면.html | DISCONNECTED | none | complexes/:slug + posts channels | wiring | unassigned | candidate leaf under #321 (rec #2) |
| 31 | 01_이웃가게_발견.html | DEMO_ONLY | none | — | A-variant artifact | none | none |
| 32 | 01_이웃가게_발견_v2.html | DEMO_ONLY | none | — | B-variant artifact | none | none |
| 33 | index2.html | DEMO_ONLY | consistency.js | — | landing B-variant artifact | none | none |
| 34 | app2.html | DEMO_ONLY | none | — | review harness | none | none |
| 35 | app3.html | DEMO_ONLY | none | — | review harness | none | none |
| 36 | 00_APP_390_통합검토.html | DEMO_ONLY | none | — | review harness | none | none |
| 37 | 18_공통앱셸.html | DEMO_ONLY | location.replace redirect | — | non-surface stub | none | none |
| 38 | 02 (A-mode detail, same file as row 25) | (see row 25) | — | — | — | — | — |
| 39 | (Vite admin app, not static) | n/a | 04_개발/frontend/src | admin routes | #334 MERGED (report R-B reviewer resolution UI, canonical resolved permissions) | #334/#315 → #310/#312/#313 chain | #310/#312/#313 |

## Totals @b70f815 (actual row basis: 39 matrix entries = 37 physical canonical HTML + 02 dup-row + 1 Vite note)
- LIVE_SERVER = 2 (index3, 26)
- HYBRID_SAFE_FALLBACK = 19 (01v3, 25A, 06, 07, 08, 09, 20, 21, 27, 19, 22, 24, 28, 25, 12, 13, 15, 16, 17; 07 carries warmth-copy HOLD note; 25A owner lane now relation-resolving via #345/#341)
- DEMO_ONLY = 8 (03v2, 01, 01v2, index2, app2, app3, 00_APP_390, 18_공통앱셸)
- DISCONNECTED = 6 (14, 10, 11, 02, 04, 05)
- POLICY_HOLD = 2 file-level (03_주민혜택_쿠폰, 23_이웃온기); 07 is HYBRID with HOLD-flagged copy
- Row-basis check: 2 + 19 + 8 + 6 + 2 = 37 physical canonical files ✓ (39 matrix rows − 02 duplicate-row − 1 Vite note)
- Canonical HTML count = 37 physical static files

## Active lane overlap
- #329 (KILO3 B6): C1 (12/13/15/16/17) DONE via PR #344; C2 (14 가입인사 kind contract + migration 047) still ACTIVE — files DO NOT overlap #331
- #331 (KILO2 B8): 19/22/24/28/25 — CLOSED via PR #340; bridge = resident-bridge.js + inquiry-bridge reuse (no signature change)
- #341 (KILO?): owner application relation resolution — CLOSED via PR #345 (raw preservation + fail-closed approval; migration 048 additive; application-report-bridge relations capability)
- #327 (B4): 25A + application-report-bridge + admin-api.ts — blockers #309/#314 merged; ready to unblock
- #334 (MERGED): Vite src only (AdminApp.tsx, admin-api.ts) — report R-B reviewer resolution UI; feeds #310/#312/#313 dependency chain (all OPEN)
- #322 operator train / #321 resident train: umbrella lanes awaiting leaf selection from this inventory
- #263 warmth HOLD: unchanged, still blocking 07/23 copy scrub (L11)

## Duplicate/superseded issue reconciliation
- #316 (this) vs #318 (closed inventory): #316's first-phase inventory IS #318's accepted deliverable. #316 should NOT re-run leaf creation. Remaining #316 value = this reconciliation delta + closing recommendation.
- Leaf issues #324/#325/#326/#328/#330/#331/#341: CLOSED+merged — correctly tracked.
- #327: still OPEN but its blockers (#309, #314) are both merged → ready for assignment; no duplicate exists.
- #329: C1 merged (PR #344); only C2 (14 + migration 047) remains — no duplication.
- #310/#312/#313: OPEN dependency chain (GAP-5 Phase-B private application document access; Wave A reviewer UI; Wave B owner status/reopen UI) — consumes #334/#341 outputs; not duplicates of #316.
- #321/#322: umbrella trains, not duplicates; consume this inventory.
- Verdict: **#316 is materially superseded by #318 + leaves #324–#331 (+ #341) for inventory; the implementation-queue remainder is fully covered by #321/#322/#327/#329-C2/#310/#312/#313 + recommendations below. Recommend closing #316 as superseded after CENTRAL accepts this reconciliation, or retitling it to track only recs #1–#4.**

## Next leaf recommendations (unassigned surfaces only)
1. **NEW leaf — resident-news 10/11 wiring** (resident-news-v1 list/detail, verified session): files 10_주민소식_목록.html, 11_주민소식_상세.html; reuse danjion-session; no backend change; add contract test; migration NO. Lane: KILO2 or KILO3 after current leaf.
2. **NEW leaf — daily-home 04 + complex hub 05 wiring** (public businesses + bookmarks + complex posts): files 04, 05; candidate under #321 train; two separate leaves (04 bookmarks; 05 complex+posts).
3. **NEW leaf — 02_이웃가게_상세 A-mode decision**: CENTRAL decision needed whether A-mode (02) survives or 01v3 is the only canonical; until then no wiring (avoid duplicate surface divergence).
4. **NEW leaf — 07/23 warmth copy scrub (L11)**: blocked by #263; pre-create leaf only when owner lifts HOLD.
5. **#327 unblock**: recommend CENTRAL assign #327 now (blockers merged; scope: private-docs read-back in 25A + reviewer context already in Vite app via #334).
6. **#310/#312/#313 chain**: assign as next serialized leaves (GAP-5 Phase-B private-doc access; reviewer/owner UIs) — prerequisites #334/#341 already merged.

## Hard-lock compliance
SOURCE_IMPLEMENTATION=0; BACKEND_CHANGE=0; SCHEMA_CHANGE=0; MIGRATION=0; PRODUCTION_MUTATION=0; no HTML/JS/CSS behavior mutation; no HOLD bypass; no active-lane file touched; no rebase/force-push. This document is the only diff.
