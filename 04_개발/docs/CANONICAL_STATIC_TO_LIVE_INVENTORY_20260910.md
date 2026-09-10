# CANONICAL_STATIC_TO_LIVE_INVENTORY — KILO1 #316 Phase 1 (Reconciliation at current main)

READ-ONLY audit. FRESH_MAIN_SHA=2a32479cd63c68d2645cb036a57a8ad2ec800758 (merge-forward chain 46c3cfc→72ad623→b70f815→03bf20a→d15392e→2a3bab0→2a32479; #340/#331, #342, #344/#329-C1, #345/#341, #349/#346, #350/#348, #353/#310-restack, #351/#347, #356/#354, #359/#312, #360/#358 merges folded in; audit is classified against the true fresh head).
Authority: this reconciliation supersedes the accepted #318 matrix (b4b50a1) where merged leaves changed surface state. UI authority = SIBLING_FINAL_V3 a2e856d per #352 (closed audit). No source, backend, schema, migration, or production changes.

## Legend
- LIVE_SERVER = page wired to real API via bridge; server mode is the primary path (demo path may still exist behind empty apiBase)
- HYBRID_SAFE_FALLBACK = real API path + explicit demo/mock fallback with first-paint mock
- DEMO_ONLY = comparison/review/harness artifact, no server intent
- DISCONNECTED = canonical user surface; backend authority exists; page makes zero API calls
- POLICY_HOLD = owner-decision gate (#59/#139/#235/#253/#263) blocks wiring

## Classification deltas since #318 (accepted at b4b50a1)
| Surface | #318 class | Class @2a3bab0 | Delta reason |
|---|---|---|---|
| index3.html | DISCONNECTED | LIVE_SERVER (server mode) | #324 session runtime + #333/#338 auth wiring merged |
| 26_우리집연결.html | DISCONNECTED | LIVE_SERVER (server mode) | #336 household-claim-bridge merged |
| 06/07/08/09 news | DISCONNECTED | HYBRID_SAFE_FALLBACK (06/07/08 sibling-v3 demo authority restored + server-mode defects repaired) | #335 danjion-news-bridge wired; public GET, no session needed. #352 found 3 unauthorized drifts (introduced by 6a1c0e0/#335); REPAIRED and CLOSED via #354/PR #356 @2a3bab0 — 07 NOTICES demo renderer restored, 06 data-kind filter + ?notice= fallback restored, 08 [data-story] dialogs restored, #335 server bridge preserved. #358 server-mode defects (06 duplicate pinned, 06 empty-state loss, 08 postId href routing) repaired and CLOSED via PR #360 @2a32479 |
| 20/21/27 messages+notif | DISCONNECTED | HYBRID_SAFE_FALLBACK | #337 messages-notifications-bridge wired (DanjionSession) |
| 25A_신청제보.html | HYBRID(owner)/DEMO(report) | HYBRID_SAFE_FALLBACK (both lanes; owner lane relation-resolving) | #309 report lane + #314 owner gallery merged; #345/#341 relation resolution + fail-closed approval |
| 19/22/24/28 profile+settings+activity | DISCONNECTED | HYBRID_SAFE_FALLBACK | #340 resident-bridge.js wired, serverConfig apiBase gate, demo-guard fallback |
| 25_1대1문의.html | DISCONNECTED | HYBRID_SAFE_FALLBACK | #340 inquiry-bridge wired, `if(!API_BASE)return` demo guard |
| 12/13/15/16/17 community | DISCONNECTED | HYBRID_SAFE_FALLBACK | #344/#329 C1 community-bridge.js wired (apiBase gate, kind map story/question/together); #352 verdict WIRING_ONLY_UI_PRESERVED |
| 14_가입인사_글쓰기 | DISCONNECTED | HYBRID_SAFE_FALLBACK | #350/#348 C2 merged: canonical greeting kind (migration 047) + community-bridge wiring with apiBase guard; #329 fully CLOSED |
| 10/11 주민소식 | DISCONNECTED | HYBRID_SAFE_FALLBACK | #349/#346 resident-news-bridge.js wired (apiBase gate, demo filters preserved); #352 verdict WIRING_ONLY_UI_PRESERVED |
| 04_데일리홈 | DISCONNECTED | HYBRID_SAFE_FALLBACK | #351/#347 merged: public businesses/bookmarks/complex fetch with demo-guard; #352 verdict WIRING_ONLY_UI_PRESERVED |
| 05_우리단지_첫화면 | DISCONNECTED | DISCONNECTED (UI authority PASS; no server wiring) | not in #347/#351 wiring scope. #352 correction: current-main 05 at audit time had only the authorized index3 rename with UI preserved — the UNAUTHORIZED_UI_DRIFT verdict applied to proposed new visible channel-latest lines in PR #351, which CENTRAL rejected (OPTION B) and KILO4 removed before merge. Current 05: UI_AUTHORITY=PASS/PRESERVED, SERVER_WIRING=NONE, BLOCKED_BY_AUTHORITY=NO. Next = bounded 05 wiring leaf (no visible redesign) if server connection is wanted |
| 01_이웃가게_발견_v3 | HYBRID_SAFE_FALLBACK | HYBRID_SAFE_FALLBACK | unchanged |
| 23/07-warmth | POLICY_HOLD | POLICY_HOLD (#263) | unchanged |
| 03 coupons mode display | POLICY_HOLD(#253/#139) | POLICY_HOLD | unchanged |
| 02_이웃가게_상세 | DISCONNECTED | DISCONNECTED | unchanged; A-mode decision pending |

## Reconciled matrix (39 canonical files @2a32479)
| # | File | Class | Bridge/runtime | Backend authority | Blocking/dependency | Lane overlap | Next leaf |
|---|---|---|---|---|---|---|---|
| 1 | index3.html | LIVE_SERVER | danjion-session.js (#324) | signup-contact-verification-v1, verified-signup-v1, auth-better-v1 | none — merged #338 | #325 CLOSED | none (done) |
| 2 | 26_우리집연결.html | LIVE_SERVER | household-claim-bridge.js + danjion-session (#336) | household-claim-v2, household-family-v2, household-master-v2 | none — merged #336 | #328 CLOSED | none (done) |
| 3 | 01_이웃가게_발견_v3.html | HYBRID_SAFE_FALLBACK | saved-shops/reviews/benefit-claim/inquiry/application-report bridges | core-v1 businesses, bookmarks, reviews, benefit-wallet, inquiries | apiBase injection at deploy/link time | L12 (unassigned; #321 train) | candidate leaf under #321 |
| 4 | 25A_신청제보.html | HYBRID_SAFE_FALLBACK | application-report-bridge.js (#309,#314) | resident-economy-v2 applications; shop-recommendations-v1 | none — both lanes merged | #327 OPEN (B4 completion: private docs read-back) | #327 |
| 5 | 06_단지온공지_목록.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) + demo restored (#354/#356) + server-mode pinned/empty-state repaired (#358/#360) | core-v1 GET /posts?channel=danjion_notice (public) | none — merged #360 | #326/#354/#358 all CLOSED | none (done) |
| 6 | 07_단지온공지_상세.html | HYBRID_SAFE_FALLBACK (warmth copy HOLD) | danjion-news-bridge (#335) + NOTICES demo renderer restored (#354/#356) | core-v1 public posts | L11 copy scrub still blocked by #263 | #326 CLOSED; L11 unassigned | copy scrub leaf (pending #263) |
| 7 | 08_아파트소식_목록.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) + demo dialogs restored (#354/#356) + postId routing repaired (#358/#360) | core-v1 public posts | none — merged #360 | #326/#354/#358 all CLOSED | none (done) |
| 8 | 09_회장인사_상세.html | HYBRID_SAFE_FALLBACK | danjion-news-bridge (#335) | core-v1 public posts | none — merged | #326 CLOSED | none (done) |
| 9 | 20_메시지함_목록.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-messages-v1 | none — merged | #330 CLOSED | none (done) |
| 10 | 21_메시지_대화상세.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-messages-v1 | none — merged | #330 CLOSED | none (done) |
| 11 | 27_알림함.html | HYBRID_SAFE_FALLBACK | danjion-session + messages-notifications-bridge (#337) | resident-notifications-v1 | none — merged | #330 CLOSED | none (done) |
| 12 | 12_이웃대화_첫화면.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344/#329 C1) | community-resident-v1 GET /community/posts (kind map resident_story/question/together) | none — merged #344 | #329 C1 DONE (PR #344); C2 pending | none (C1 done) |
| 13 | 13_이웃대화_글상세_댓글.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 detail + community-replies-v1 | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 14 | 14_가입인사_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#350/#348 C2) | community-resident-v1 POST greeting (migration 047 kind contract) | none — merged #350 | #329 FULLY CLOSED (C1 #344 + C2 #350) | none (done) |
| 15 | 15_단지이야기_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST resident_story | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 16 | 16_궁금해요_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST question | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 17 | 17_같이해요_글쓰기.html | HYBRID_SAFE_FALLBACK | danjion-session + community-bridge.js (#344) | community-resident-v1 POST together | none — merged #344 | #329 C1 DONE | none (C1 done) |
| 18 | 19_내정보_메인.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | core-v1 /me; resident-summary-v1 | none — merged #340 | #331 CLOSED (PR #340) | none (done) |
| 19 | 22_주민_공개프로필.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | resident-profile-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 20 | 24_설정.html | HYBRID_SAFE_FALLBACK | resident-bridge.js (#340) | resident-settings-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 21 | 28_나의활동.html | HYBRID_SAFE_FALLBACK | resident-bridge.js + activity-28.js local render (#340) | resident-activity-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 22 | 25_1대1문의.html | HYBRID_SAFE_FALLBACK | inquiry-bridge.js reuse (#340; signature unchanged) | inquiries-v1 | none — merged #340 | #331 CLOSED | none (done) |
| 23 | 10_주민소식_목록.html | HYBRID_SAFE_FALLBACK | resident-news-bridge.js (#349/#346) | resident-news-v1 (verified) | none — merged #349 | #346 CLOSED; #352 verdict WIRING_ONLY_UI_PRESERVED | none (done) |
| 24 | 11_주민소식_상세.html | HYBRID_SAFE_FALLBACK | resident-news-bridge.js (#349/#346) | resident-news-v1 detail | none — merged #349 | #346 CLOSED; #352 verdict WIRING_ONLY_UI_PRESERVED | none (done) |
| 25 | 02_이웃가게_상세.html | DISCONNECTED | none; hardcoded SHOPS | core-v1 businesses/:id + reviews | superseded by 01v3 in B mode; wire only if A-mode survives | none | hold as artifact (see rec #4) |
| 26 | 03_주민혜택_쿠폰.html | POLICY_HOLD | consistency.js | core-v1 /benefits + benefit-wallet-v1 | delivery-mode display #253/#139 | none | hold (#253/#139) |
| 27 | 03_주민혜택_쿠폰_v2.html | DEMO_ONLY | consistency.js | — | comparison artifact | none | none |
| 28 | 23_이웃온기.html | POLICY_HOLD | none | NONE (no backend warmth) | #263 BLOCKED_BY_OWNER_DECISION; copy violates HOLD | none | copy scrub leaf only (pending #263) |
| 29 | 04_데일리홈.html | HYBRID_SAFE_FALLBACK | homePublicJson fetch, DanjionSession apiBase + demo-guard (#351/#347) | businesses public + bookmarks + complexes | none — merged #351 | #347 CLOSED (B11); #352 verdict WIRING_ONLY_UI_PRESERVED | none (done) |
| 30 | 05_우리단지_첫화면.html | DISCONNECTED | none | complexes/:slug + posts channels | none — UI authority PASS (sibling-v3 preserved; #352 drift verdict applied only to removed PR-#351 proposed lines, CENTRAL OPTION B); no authority blocker | unassigned (no lane) | bounded 05 wiring leaf (no visible redesign) |
| 31 | 01_이웃가게_발견.html | DEMO_ONLY | none | — | A-variant artifact | none | none |
| 32 | 01_이웃가게_발견_v2.html | DEMO_ONLY | none | — | B-variant artifact | none | none |
| 33 | index2.html | DEMO_ONLY | consistency.js | — | landing B-variant artifact | none | none |
| 34 | app2.html | DEMO_ONLY | none | — | review harness | none | none |
| 35 | app3.html | DEMO_ONLY | none | — | review harness | none | none |
| 36 | 00_APP_390_통합검토.html | DEMO_ONLY | none | — | review harness | none | none |
| 37 | 18_공통앱셸.html | DEMO_ONLY | location.replace redirect | — | non-surface stub | none | none |
| 38 | 02 (A-mode detail, same file as row 25) | (see row 25) | — | — | — | — | — |
| 39 | (Vite admin app, not static) | n/a | 04_개발/frontend/src | admin routes | #334 MERGED; #353/#310-restack merged (private doc access backend) | #334/#315 → #312/#313 (unblocked, OPEN) | #312/#313 |

## Totals @2a32479 (actual row basis: 39 matrix entries = 37 physical canonical HTML + 02 dup-row + 1 Vite note)
- LIVE_SERVER = 2 (index3, 26)
- HYBRID_SAFE_FALLBACK = 23 (01v3, 25A, 06, 07, 08, 09, 20, 21, 27, 19, 22, 24, 28, 25, 12, 13, 15, 16, 17, 14, 10, 11, 04; 06/07/08 sibling-v3 demo authority restored via #354/#356 AND server-mode defects repaired via #358/#360; 07 also warmth-copy HOLD #263)
- DEMO_ONLY = 8 (03v2, 01, 01v2, index2, app2, app3, 00_APP_390, 18_공통앱셸)
- DISCONNECTED = 2 (02_이웃가게_상세 [A-mode decision pending], 05_우리단지_첫화면 [UI authority PASS, SERVER_WIRING=NONE — bounded wiring leaf available])
- POLICY_HOLD = 2 file-level (03_주민혜택_쿠폰, 23_이웃온기); 07 is HYBRID with HOLD-flagged copy
- Row-basis check: 2 + 23 + 8 + 2 + 2 = 37 physical canonical files ✓ (39 matrix rows − 02 duplicate-row − 1 Vite note)
- Canonical HTML count = 37 physical static files
- Note: #312/#359 touched Vite app + backend only (no canonical static surface) and #358/#360 touched 06/08 server-mode behavior only (class stays HYBRID_SAFE_FALLBACK) — totals unchanged by evidence, not by assumption

## Active lane overlap
- #329 (KILO3 B6): FULLY CLOSED — C1 via PR #344, C2 (greeting kind + 14) via PR #350 (migration 047 merged)
- #331 (KILO2 B8): 19/22/24/28/25 — CLOSED via PR #340
- #341: owner application relation resolution — CLOSED via PR #345 (raw preservation + fail-closed approval; migration 048; application-report-bridge relations capability)
- #346 (B10 resident-news 10/11): CLOSED via PR #349
- #347 (B11 daily-home 04): CLOSED via PR #351; 05 excluded from #351 wiring scope, remains DISCONNECTED with UI authority PASS
- #348 (B6-C2 greeting): CLOSED via PR #350
- #352 (authority audit): CLOSED — UI authority = SIBLING_FINAL_V3 a2e856d; 06/07/08 drifts + PR-#351-proposed 05 channel-latest lines classified UNAUTHORIZED_UI_DRIFT; CENTRAL OPTION B removed the 05 lines before merge; all merged wiring verdicts WIRING_ONLY_UI_PRESERVED; BACKEND_ADAPTS_TO_FRONTEND=YES
- #354 (UI authority repair 06/07/08): CLOSED via PR #356 @2a3bab0 — sibling-final-v3 demo behavior restored (07 NOTICES renderer, 06 data-kind filter + ?notice= fallback, 08 [data-story] dialogs), #335 server bridge preserved, contract-gated
- #358 (news server-mode follow-up): CLOSED via PR #360 @2a32479 — 06 duplicate pinned fixed, 06 empty-state (#noticeEmpty) preserved in server render, 08 server feature-link postId routing to 09 fixed; demo authority intact
- #310/#353 (GAP-5 private doc access backend): CLOSED/MERGED (03bf20a restack); #310 replaced by leaf #353
- #312 (Wave A reviewer private-doc UI): CLOSED via PR #359 @dac560a — Vite app (OperationsReviewPage.tsx, operations-review-api.ts) + backend admin-review-context-v1; no canonical static surface touched
- #313 (Wave B owner status/reopen UI): OPEN, now BLOCKED_BY #362
- #362 (owner documents: expose opaque document row id in owner application metadata): OPEN, assigned KILO3 — sole prerequisite for #313
- #327 (B4): 25A private-docs read-back — waits on #313 closeout (reviewer side #312 already done)
- #316 (this audit): OPEN pending CENTRAL merge of #343 + close-as-superseded
- #322 operator train / #321 resident train: umbrella lanes; #321 remainder = 02 (decision) + 05 (bounded wiring leaf)
- #263 warmth HOLD: unchanged, still blocking 07/23 copy scrub (L11)

## Duplicate/superseded issue reconciliation
- #316 (this) vs #318 (closed inventory): #316's first-phase inventory IS #318's accepted deliverable. #316 should NOT re-run leaf creation. Remaining #316 value = this reconciliation delta + closing recommendation.
- Leaf issues #324/#325/#326/#328/#330/#331/#341/#346/#347/#348/#354/#358/#312: CLOSED+merged — correctly tracked.
- #329: FULLY CLOSED (C1 PR #344; C2 PR #350, migration 047 merged).
- #310: replaced by leaf #353 (private document access backend restack, MERGED at 03bf20a).
- #313: OPEN, BLOCKED_BY #362 (KILO3 owner document-id metadata) — remaining private-doc UI leaf.
- #327: OPEN; waits on #313 closeout (reviewer side done) — no duplicate.
- #352: CLOSED authority audit (SIBLING_FINAL_V3 a2e856d; 56 surfaces); #354 repair CLOSED via #356; server-mode remainder CLOSED via #358/#360.
- #321/#322: umbrella trains, not duplicates; consume this inventory.
- Verdict: **#316 is materially superseded by #318 + implemented leaves #324–#331/#341/#346/#347/#348/#354/#358/#312 (+ #353 backend). The wiring remainder is 02 (A-mode decision) + 05 (bounded wiring leaf, no authority blocker) only; remaining UI work lives in #362 → #313 → #327. Recommend closing #316 as superseded once CENTRAL merges PR #343.**

## Next leaf recommendations (current unassigned/blocked surfaces only)
1. **#362 assignment** (already KILO3): owner document-id metadata — unblocks #313.
2. **#313 after #362**: owner application status + private-document reopen UI.
3. **#327 after #313 closeout**: 25A private-docs read-back.
4. **05_우리단지_첫화면 wiring leaf**: UI_AUTHORITY=PASS, BLOCKED_BY_AUTHORITY=NO — bounded wiring (complexes/:slug + posts channels, no visible redesign) available now if wanted.
5. **02_이웃가게_상세 A-mode decision** (CENTRAL): whether A-mode survives or 01v3 is sole canonical; until decided, no wiring.
6. **07/23 warmth copy scrub (L11)**: still blocked by #263; pre-create only when owner lifts HOLD.

## Hard-lock compliance
SOURCE_IMPLEMENTATION=0; BACKEND_CHANGE=0; SCHEMA_CHANGE=0; MIGRATION=0; PRODUCTION_MUTATION=0; no HTML/JS/CSS behavior mutation; no HOLD bypass (#263 untouched); no active-lane file touched; no rebase/force-push/trigger commit. This document is the only diff.
