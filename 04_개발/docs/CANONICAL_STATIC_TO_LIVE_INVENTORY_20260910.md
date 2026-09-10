# CANONICAL_STATIC_TO_LIVE_INVENTORY — KILO1 #316 Phase 1 (Reconciliation at current main)

READ-ONLY audit. FRESH_MAIN_SHA=46c3cfc6c490db2331da935e821fe82f263e35f2 (assignment-time main was 769bc230; #336 household + #314 owner-gallery merged between assignment and audit; audit is classified against the true fresh head).
Authority: this reconciliation supersedes the accepted #318 matrix (b4b50a1) where merged leaves changed surface state. No source, backend, schema, migration, or production changes.

## Legend
- LIVE_SERVER = page wired to real API via bridge; server mode is the primary path (demo path may still exist behind empty apiBase)
- HYBRID_SAFE_FALLBACK = real API path + explicit demo/mock fallback with first-paint mock
- DEMO_ONLY = comparison/review/harness artifact, no server intent
- DISCONNECTED = canonical user surface; backend authority exists; page makes zero API calls
- POLICY_HOLD = owner-decision gate (#59/#139/#235/#253/#263) blocks wiring

## Classification deltas since #318 (accepted at b4b50a1)
| Surface | #318 class | Class @46c3cfc | Delta reason |
|---|---|---|---|
| index3.html | DISCONNECTED | LIVE_SERVER (server mode) | #324 session runtime + #333/#338 auth wiring merged |
| 26_우리집연결.html | DISCONNECTED | LIVE_SERVER (server mode) | #336 household-claim-bridge merged |
| 06/07/08/09 news | DISCONNECTED | HYBRID_SAFE_FALLBACK | #335 danjion-news-bridge wired; public GET, no session needed |
| 20/21/27 messages+notif | DISCONNECTED | HYBRID_SAFE_FALLBACK | #337 messages-notifications-bridge wired (DanjionSession) |
| 25A_신청제보.html | HYBRID(owner)/DEMO(report) | HYBRID_SAFE_FALLBACK (both lanes) | #309 report lane + #314 owner gallery merged |
| 19/22/24/28 + 25 | DISCONNECTED | DISCONNECTED (leaf #331 OPEN) | no wiring on main yet |
| 12/13/15/16/17 + 14 | DISCONNECTED | DISCONNECTED (leaf #329 OPEN) | no wiring on main yet |
| 01_이웃가게_발견_v3 | HYBRID_SAFE_FALLBACK | HYBRID_SAFE_FALLBACK | unchanged |
| 23/07-warmth | POLICY_HOLD | POLICY_HOLD (#263) | unchanged |
| 03 coupons mode display | POLICY_HOLD(#253/#139) | POLICY_HOLD | unchanged |
| 02/04/05/10/11 | DISCONNECTED | DISCONNECTED | unchanged; 10/11 owned by #329-adjacent resident-news (see overlap) |

## Reconciled matrix (39 canonical files @46c3cfc)
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
| 12 | 12_이웃대화_첫화면.html | DISCONNECTED | none | community-resident-v1 GET /community/posts | wiring + session | #329 (KILO3 B6) — ACTIVE LANE | #329 |
| 13 | 13_이웃대화_글상세_댓글.html | DISCONNECTED | none | community-resident-v1 + community-replies-v1 | wiring + session | #329 — ACTIVE LANE | #329 |
| 14 | 14_가입인사_글쓰기.html | DISCONNECTED | none | needs kind='greeting' (migration 047) | server kind contract + migration 047 | #329 C2 — ACTIVE LANE | #329 (migration 047) |
| 15 | 15_단지이야기_글쓰기.html | DISCONNECTED | none | community-resident-v1 POST resident_story | wiring | #329 — ACTIVE LANE | #329 |
| 16 | 16_궁금해요_글쓰기.html | DISCONNECTED | none | community-resident-v1 POST question | wiring | #329 — ACTIVE LANE | #329 |
| 17 | 17_같이해요_글쓰기.html | DISCONNECTED | none | community-resident-v1 POST together | wiring | #329 — ACTIVE LANE | #329 |
| 18 | 19_내정보_메인.html | DISCONNECTED | none | core-v1 /me; resident-summary-v1 | wiring + session | #331 (KILO2 B8) — ACTIVE LANE | #331 |
| 19 | 22_주민_공개프로필.html | DISCONNECTED | none | resident-profile-v1 | wiring | #331 — ACTIVE LANE | #331 |
| 20 | 24_설정.html | DISCONNECTED | none | resident-settings-v1 | wiring | #331 — ACTIVE LANE | #331 |
| 21 | 28_나의활동.html | DISCONNECTED | consistency.js + assets/pages/activity-28.js (local render only) | resident-activity-v1 | wiring | #331 — ACTIVE LANE | #331 |
| 22 | 25_1대1문의.html | DISCONNECTED | none (inquiry-bridge.js exists, used by 01v3) | inquiries-v1 | wiring; reuse bridge, no signature change | #331 — ACTIVE LANE | #331 |
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
| 39 | (Vite admin app, not static) | n/a | 04_개발/frontend/src | admin routes | #334 Draft active (KILO3 #315 lane) | #334/#315 | #315 |

## Totals @46c3cfc (39 canonical files; rows 25/38 same file, counted once → 38 physical + 1 Vite note)
- LIVE_SERVER = 2 (index3, 26)
- HYBRID_SAFE_FALLBACK = 8 (01v3, 25A, 06, 07, 08, 09, 20, 21, 27 → count: 01v3, 25A, 06, 07, 08, 09, 20, 21, 27 = 9 pages; 07 carries warmth-copy HOLD note)
  - corrected: HYBRID_SAFE_FALLBACK = 9
- DEMO_ONLY = 8 (03v2, 01, 01v2, index2, app2, app3, 00_APP_390, 18_공통앱셸)
- DISCONNECTED = 16 (12, 13, 14, 15, 16, 17, 19, 22, 24, 28, 25, 10, 11, 02, 04, 05)
- POLICY_HOLD = 3 (03_주민혜택_쿠폰, 23_이웃온기, 07-warmth-copy [07 counted in HYBRID; HOLD applies to copy only])
  - corrected: POLICY_HOLD = 2 file-level (03, 23); 07 is HYBRID with HOLD-flagged copy
- Canonical HTML count = 37 physical static files (39 list entries − 02 duplicate-row − 1 Vite note)

## Active lane overlap
- #329 (KILO3 B6): 12/13/14/15/16/17 + community-resident-v1 + migration 047 — files DO NOT overlap #331
- #331 (KILO2 B8): 19/22/24/28/25 + inquiry-bridge.js — files DO NOT overlap #329
- #327 (B4): 25A + application-report-bridge + admin-api.ts — blocked_by #309/#314 (both now merged); ready to unblock
- #334 Draft (KILO3 #315): Vite src only (AdminApp.tsx, admin-api.ts, mock-recommendation-store.ts) — no static-file overlap
- #322 operator train / #321 resident train: umbrella lanes awaiting leaf selection from this inventory

## Duplicate/superseded issue reconciliation
- #316 (this) vs #318 (closed inventory): #316's first-phase inventory IS #318's accepted deliverable. #316 should NOT re-run leaf creation. Remaining #316 value = this reconciliation delta + closing recommendation.
- Leaf issues #324/#325/#326/#328/#330: CLOSED+merged — correctly tracked.
- #327: still OPEN but its blockers (#309, #314) are both merged → ready for assignment; no duplicate exists.
- #329/#331: OPEN, assigned to KILO3/KILO2 — no duplication.
- #321/#322: umbrella trains, not duplicates; consume this inventory.
- Verdict: **#316 is materially superseded by #318 + leaves #324–#331 for inventory; the implementation-queue remainder is fully covered by #321/#322/#327/#329/#331 + recommendations below. Recommend closing #316 as superseded after CENTRAL accepts this reconciliation, or retitling it to track only recs #1–#4.**

## Next leaf recommendations (unassigned surfaces only)
1. **NEW leaf — resident-news 10/11 wiring** (resident-news-v1 list/detail, verified session): files 10_주민소식_목록.html, 11_주민소식_상세.html; reuse danjion-session; no backend change; add contract test; migration NO. Lane: KILO2 or KILO3 after current leaf.
2. **NEW leaf — daily-home 04 + complex hub 05 wiring** (public businesses + bookmarks + complex posts): files 04, 05; candidate under #321 train; two separate leaves (04 bookmarks; 05 complex+posts).
3. **NEW leaf — 02_이웃가게_상세 A-mode decision**: CENTRAL decision needed whether A-mode (02) survives or 01v3 is the only canonical; until then no wiring (avoid duplicate surface divergence).
4. **NEW leaf — 07/23 warmth copy scrub (L11)**: blocked by #263; pre-create leaf only when owner lifts HOLD.
5. **#327 unblock**: recommend CENTRAL assign #327 now (blockers merged; scope: private-docs read-back in 25A + reviewer context already in Vite app).

## Hard-lock compliance
SOURCE_IMPLEMENTATION=0; BACKEND_CHANGE=0; SCHEMA_CHANGE=0; MIGRATION=0; PRODUCTION_MUTATION=0; no HTML/JS/CSS behavior mutation; no HOLD bypass; no active-lane file touched; no rebase/force-push. This document is the only diff.
