# DanjiOn V2 Reference Parity Matrix

Status: `V2_D_QA_CONTRACT_READY` / FIDELITY NOT YET PASS  
Track: V2-D / Issue #29  
Branch: `feat/v2-d-fidelity-qa`  
Program: #25 / governance #32 / integration #30

## 1. Source lock and evidence

This matrix is grounded in the fixed V2 source, not in the current V1 visual structure.

| Evidence | Fixed input | Verification performed by V2-D |
|---|---|---|
| Canonical HTML | Google Drive `01_단지온_8월현장시연_통합시제품_v1_이미지리프레시.html`, id `18Tl6-J5q9_7ZXx0Rb9FZS--QifQ09aZB` | Downloaded as raw bytes and read end-to-end. Local SHA256 = `70d925fffdb24f752cce489fccd97bda2b5856edafe982be4a7e6abc54546f85`, exactly matching the program lock. |
| Source checksum manifest | `SHA256.txt` | Read end-to-end. It locks the HTML, eight scene WebPs, `ui-icons.svg`, and the image-source manifest. |
| Image manifest | `이미지출처_및_교체내역.md` | Read end-to-end. Confirms the image-refresh changes photographs only; layout, function, motion, and copy are intended to remain unchanged. |
| Scene assets | `05_실행자산/scene-*.webp`, `ui-icons.svg` | Folder enumerated: food, learning, home-care, professional, craft, car, beauty, photo + icon sprite. |
| Execution evidence | `녹화-11_8월현장시연_통합시제품_v1_이미지리프레시.mp4`, Drive id `13kpM0HeS_WG9lXbuWk9uVvbBConKJ6ai` | 1920×1080 / 30fps / 115.472834s recording inspected at regular intervals. It corroborates hero → cinematic scene → discovery/filter/detail → benefits → registration → ending/My Info → hero circulation. |
| V1 regression baseline | current `04_개발/frontend/e2e/*` + `playwright.config.ts` | Existing search/detail/contact, benefit wallet, resident registration/admin approval/publication, resident verification, mobile navigation and overflow tests reviewed before defining V2 gates. |

The fixed HTML is approximately 98 KB and contains its own CSS/JS prototype state machine. The React implementation is allowed to change component boundaries, but not the user-observable structural intent below.

## 2. Status vocabulary

- `SOURCE_LOCK_PASS`: the fixed source evidence itself was verified.
- `CONTRACT_READY`: V2-D has an executable assertion for this requirement.
- `BLOCKED_A`: requires V2-A visual output before runtime fidelity can be measured.
- `BLOCKED_B`: requires V2-B product-flow output before runtime behavior can be measured.
- `BLOCKED_C`: requires V2-C routing/gateway output before the relevant safety check can run on the integrated branch.
- `BLOCKED_INTEGRATION`: A/B/C have not yet been composed on #30, so an end-to-end fidelity verdict is forbidden.
- `PASS`: reserved for a check that actually executed against the integrated A/B/C/D commit. It is deliberately not used for overall V2 fidelity on this branch.

## 3. Parity matrix

| ID | Reference evidence / behavior | Required V2 parity | Automated gate | Current V2-D verdict |
|---|---|---|---|---|
| SRC-01 | Fixed Drive HTML id + SHA256 lock | Tests must target this exact source definition; a changed source requires a new source-lock decision | `tests/v2/reference-contract.ts`, source section of `V2_QA_GATE.md` | `SOURCE_LOCK_PASS` |
| SRC-02 | Eight distinct work-scene images + local WebP fallbacks | V2 must preserve real-photo, category-specific scene intent rather than collapse to generic V1 icon cards | hero image natural-size check + cinematic service/scene checks | `CONTRACT_READY / BLOCKED_A` |
| H-01 | fixed editorial `.topbar` | topbar remains fixed, branded `단지온`, and visually separate from content | `v2-fidelity.spec.ts` fixed-position assertion | `CONTRACT_READY / BLOCKED_A` |
| H-02 | hero heading `필요한 일, 우리 단지에서 먼저 찾아보세요` | large editorial hero copy remains present | `v2-fidelity.spec.ts` heading assertion | `CONTRACT_READY / BLOCKED_A` |
| H-03 | hero search placeholder begins `무슨 일이 필요하세요?` and is present in first screen | search must be visible without scrolling at 1440, 1024, 390 and 320 widths | `v2-fidelity.spec.ts`, `v2-responsive-accessibility.spec.ts` viewport-bound assertion | `CONTRACT_READY / BLOCKED_A+B` |
| H-04 | asymmetric copy/photo hero; remote real photo with local fallback | substantial real photo remains part of hero; desktop photo occupies a material share of hero | natural image dimensions + desktop hero/image geometry | `CONTRACT_READY / BLOCKED_A` |
| CIN-01 | `#liveScenes` / 360vh scroll story with sticky full-screen stage | cinematic system remains a distinct opening story before product UI | cinematic locator and section-order assertions | `CONTRACT_READY / BLOCKED_A` |
| CIN-02 | four tabs: 반찬 / 수학 / 집·생활 / 사업·문서 | exactly the four fixed reference scene choices remain reachable | four accessible scene-tab assertions | `CONTRACT_READY / BLOCKED_A` |
| CIN-03 | selected scene changes image/copy/service and category color | selection changes visible scene and panel color, not only hidden state | scene click + `aria-selected` + heading/service + computed color change | `CONTRACT_READY / BLOCKED_A` |
| CIN-04 | scene tabs support left/right/up/down keys in source JS | keyboard scene switching must remain operable | ArrowRight focus/selection assertion | `CONTRACT_READY / BLOCKED_A` |
| CIN-05 | desktop/tablet sticky; <=800px scene becomes normal document flow | desktop/tablet retain cinematic sticky treatment while mobile does not trap scrolling | computed `position` at 1440/1024 vs 390/320 | `CONTRACT_READY / BLOCKED_A` |
| CIN-06 | source uses scene rail/tabs and strong category transitions | rail/tab navigation must remain visible or equivalently expose the four scene positions without losing selection semantics | accessible tab coverage; visual rail remains manual review item in QA Gate | `CONTRACT_READY / BLOCKED_A` |
| DISC-01 | Scene 03 heading `가까운 사람의 일을 먼저 보여줍니다.` | product discovery begins after cinematic opening | section order + heading assertion | `CONTRACT_READY / BLOCKED_A+B` |
| DISC-02 | category filters: 전체, 먹고 마시는 일, 배우고 가르치는 일, 집을 돌보는 일, 사업을 돕는 일, 만들고 기록하는 일 | category filtering remains user-operable and reports selected state | product-flow filter `aria-pressed` assertion | `CONTRACT_READY / BLOCKED_B` |
| DISC-03 | relation priority `우리 단지 주민 → 주민 가족 → 이웃 단지 → 일반 제휴` | relation filter and relationship-first product semantics are not lost | resident-family filter + matching result assertion; priority remains documented contract | `CONTRACT_READY / BLOCKED_B` |
| DISC-04 | hero search maps intent to discovery; reference includes `에어컨` → home category | search `에어컨` must expose `온케어 홈서비스` | `v2-product-flow.spec.ts` search smoke | `CONTRACT_READY / BLOCKED_B` |
| DETAIL-01 | detail modal with gallery, relation, work, price, area, benefit, availability | service detail remains a readable modal/surface, not a dead card | open detail + heading/content assertions | `CONTRACT_READY / BLOCKED_B` |
| DETAIL-02 | `온케어 홈서비스`: 주민 가족 / 에어컨 1대 7만원부터 / 출장비 면제 | fixed exemplar retains source information semantics | exact detail-content assertions | `CONTRACT_READY / BLOCKED_B` |
| DETAIL-03 | contact box hidden until `문의 방법 보기`; source notes verified-resident privacy | contact disclosure remains explicit action and existing privacy assumptions are preserved | contact button presence; existing V1 privacy/product contracts remain regression baseline | `CONTRACT_READY / BLOCKED_B` |
| BEN-01 | benefit scene heading `혜택이 실제 행동이 됩니다.` | benefits remain a first-class product section | section heading/order assertion | `CONTRACT_READY / BLOCKED_A+B` |
| BEN-02 | `주민혜택 받기` → generated `DANJION-*` → `보관 중` | claiming produces a resident wallet state | `v2-product-flow.spec.ts` claim/code/stored assertions | `CONTRACT_READY / BLOCKED_B` |
| BEN-03 | My Info exposes received benefits and `사용 완료 처리` | stored benefit can be consumed and state becomes `사용 완료` | claim → My Info → use assertion | `CONTRACT_READY / BLOCKED_B` |
| REG-01 | registration entry `내 일 알리기` | resident can enter registration from the V2 journey | product-flow registration smoke | `CONTRACT_READY / BLOCKED_B` |
| REG-02 | exact four steps: 주민 관계 → 기본정보 → 사진/혜택 → 공개/비공개 review | four-step progression and core information architecture remain intact | each `STEP n / 4` + heading assertion | `CONTRACT_READY / BLOCKED_B` |
| REG-03 | relation selection includes `현재 단지 주민 직접 운영` | resident relationship classification remains explicit | registration relation selection | `CONTRACT_READY / BLOCKED_B` |
| REG-04 | fields: 이름/가게명, 무슨 일, 가격/상담, 이용지역/방식, 문의방식, 입주민 혜택 | source information can be entered in V2 without loss | label-driven field fill assertions | `CONTRACT_READY / BLOCKED_B` |
| REG-05 | final review separates `주민에게 공개` and `운영확인용 · 비공개` | public/private boundary remains visible before submit | four-step review + operator public/private assertions | `CONTRACT_READY / BLOCKED_B` |
| PROMO-01 | promo heading `입력한 생활정보가 홍보물로 정돈됩니다.` | submitted information flows into promotion-material stage | section-order + registration-cycle assertions | `CONTRACT_READY / BLOCKED_A+B` |
| PROMO-02 | outputs: 단지온 가게소개 카드 / 카카오톡 공유 이미지 / 엘리베이터 게시판 포스터 | all three reference promotion outputs remain represented | exact promo-output assertions after `홍보물 만들기` | `CONTRACT_READY / BLOCKED_B` |
| OPS-01 | `운영확인으로 이동`; operator sees public and private panels | review stage remains separate from resident publication | operator dialog assertions | `CONTRACT_READY / BLOCKED_B` |
| OPS-02 | `보완요청` / `승인하여 공개` | approval cycle remains explicit; approval is not bypassed | approve action assertion; existing V1 changes-requested audit test remains regression baseline | `CONTRACT_READY / BLOCKED_B` |
| LOOP-01 | after approval the prototype returns to discovery and the newly approved work becomes discoverable | journey closes `등록 → 홍보물 → 운영확인/승인 → 다시 발견` | unique-name registration → approval → rediscovery assertion | `CONTRACT_READY / BLOCKED_B` |
| MY-01 | My Info: 저장한 이웃가게 / 받은 주민혜택 | V2 retains personal saved/wallet status controls | benefit cycle opens My Info and verifies wallet state | `CONTRACT_READY / BLOCKED_B` |
| MY-02 | `글자 크게`, `모션 줄이기`, `시연 상태 초기화` | accessibility/demo controls remain available or equivalent | reduced-motion test verifies motion control; large-text/reset remain matrix/manual integration review | `CONTRACT_READY / BLOCKED_A+B` |
| RESP-01 | source desktop large split layouts | 1440×1000 layout loads with first-screen search and no horizontal overflow | responsive spec desktop project | `CONTRACT_READY / BLOCKED_A+B` |
| RESP-02 | <=1050 tablet adaptation | 1024×900 is explicitly tested, including cinematic sticky and overflow | responsive spec tablet project | `CONTRACT_READY / BLOCKED_A+B` |
| RESP-03 | <=800 mobile stack and bottom nav | 390×844 mobile has mobile nav, first-screen search and no overflow | responsive spec mobile-390 project | `CONTRACT_READY / BLOCKED_A+B` |
| RESP-04 | <=380 compact typography/layout | 320×720 is a hard minimum-width gate; no horizontal overflow | responsive spec mobile-320 project | `CONTRACT_READY / BLOCKED_A+B` |
| A11Y-01 | source skip link + global `:focus-visible` outline | keyboard navigation must expose a visible focus indicator | Tab-to-search and computed outline assertion | `CONTRACT_READY / BLOCKED_A+B` |
| A11Y-02 | scene tab arrow-key JS | scene selection must be keyboard operable | ArrowRight focus/selection assertion | `CONTRACT_READY / BLOCKED_A` |
| A11Y-03 | modal open places focus on close control | dialog focus must not be lost on open | Enter-to-detail + focused close assertion | `CONTRACT_READY / BLOCKED_B` |
| A11Y-04 | semantic labels/dialogs/buttons throughout source | no serious/critical axe violations on the main V2 surface | `@axe-core/playwright` automated scan | `CONTRACT_READY / BLOCKED_A+B` |
| RM-01 | source `@media(prefers-reduced-motion:reduce)` disables hero/ending motion and sticky cinematic behavior | OS reduced-motion preference removes long decorative motion without breaking content | emulated reduced motion + active-animation duration + non-sticky stage | `CONTRACT_READY / BLOCKED_A` |
| RM-02 | source still allows scene selection under reduced motion | motion reduction must not remove navigation/function | reduced-motion scene click + heading assertion | `CONTRACT_READY / BLOCKED_A` |
| GW-01 | C contract: unset/invalid variant → V1 | no V2 takeover when variant absent or invalid | `v2-v1-safety.spec.ts` run with v1 + invalid builds; existing V1 suite also run with env unset | `CONTRACT_READY / BLOCKED_C_INTEGRATION` |
| GW-02 | C Gateway is isolated and links to V1 and V2 origins | gateway must not render V1/V2 product UI inline and links must target configured origins | `v2-gateway-safety.spec.ts` | `CONTRACT_READY / BLOCKED_C_INTEGRATION` |
| GW-03 | C current branch intentionally renders `V2IntegrationPending` until B integration | integrated candidate must fail if placeholder survives | `v2-fidelity-gate.mjs` preflight + `openV2()` hard assertion | `CONTRACT_READY`; current integrated fidelity intentionally BLOCKED |
| V1-01 | V1 is the current functional baseline | D must not alter V1 behavior or styles | existing `playwright.config.ts` suite runs unchanged with `VITE_UI_VARIANT` unset | `CONTRACT_READY`; V1 regression must pass at #30 |
| V1-02 | V1 mobile nav + `#home-search` + no overflow | explicit/invalid V1 builds remain safe | `v2-v1-safety.spec.ts` + existing mobile test | `CONTRACT_READY / BLOCKED_C_INTEGRATION` |

## 4. Execution-recording cross-check

The recording is corroborating evidence, not a replacement for the byte-locked HTML. Approximate sampled states observed by V2-D:

| Approx. time | Observed surface |
|---:|---|
| 0s | split first-screen hero, large Korean heading/search, real photo |
| 10s | cinematic food scene with strong orange information panel |
| 20–30s | discovery/filter/card system |
| 40s | photo-rich service detail dialog |
| 60s | dark benefit section / benefit action |
| 70–80s | four-step registration dialog |
| 90s | circular-economy ending / transition after product cycle |
| 100s | My Info controls/status |
| 110s | return to hero/search |

The Gate therefore checks the *sequence and interaction contract*, not pixel-by-pixel snapshots from this recording.

## 5. V1 baseline carried forward

V2-D does not weaken or duplicate the current V1 suite. At #30 integration the gate runs it unchanged first. Current baseline includes:

- mobile bottom navigation, resident benefit navigation, no horizontal overflow, return to `#home-search`;
- search → service detail → bookmark → verified contact disclosure;
- changes-requested business application → edit → resubmit → audit history;
- four-step resident submission with representative image → admin approval → approved status → public search;
- admin-created news and benefit surfaced in resident app;
- resident verification unverified → pending → verified and rejected → corrected → reapplied;
- benefit claim → stored code → use, idempotency, and detail state reflection;
- live-release surface checks for `/`, admin and verification pages at release viewports.

## 6. Current fidelity verdict

**Overall V2 fidelity: `BLOCKED_A_B_C_INTEGRATION`.**

V2-D has produced the parity contract and executable gate, but it is prohibited from declaring fidelity PASS while A/B/C are still sibling outputs. Track C has a published Draft output, but the current V2 program integration branch has not yet composed A/B/C/D and C itself deliberately retains a `V2IntegrationPending` placeholder until B is integrated.

Track verdict for this branch:

# `V2_D_QA_CONTRACT_READY`

Only #30 may run the gate against fixed, integrated A/B/C/D heads and promote the result to an integrated V2 verdict.
