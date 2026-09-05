# TRACK G — R1 PARITY SLICE WORK ORDER

## 1. Mission

Add baseline-comparison-driven visual and interaction parity contract tests for six R1 screens, applying only small corrective fixes where drift is found. This track is frontend parity contracts + minor visual corrections only.

Repository: `skerishKang/02-danji-on`
Base: `origin/main` (= `a4021f0`)
Issue: #246 (R1 slice)
Branch: `feat/track-g-r1-parity-slice` (Draft PR only, no merge)
Source of truth: `04_개발/docs/v2/R0_DRIFT_MATRIX_20260905.md` (20260904 design handoff vs current V2)

## 2. Scope

Six screens, each implemented with a dedicated panel/portal and backend route already present:

| # | Screen | Current V2 implementation | Backend route |
|---|---|---|---|
| 24 | 설정 | V2SettingsPanel + V2AccountClosurePortal | resident-settings-v1 / account-lifecycle-v1 |
| 27 | 알림함 | V2NotificationsPortal / V2NotificationsPanel | resident-notifications-v1 |
| 25 | 1:1문의 | V2InquiriesPortal | inquiries-v1 |
| 28 | 나의활동 | V2ActivityPortal / V2ActivityPanel | resident-activity-v1 |
| 26 | 우리집연결 | V2HouseholdPortal | household-family-v2 |
| 25A | 신청제보 | V2RegistrationFlow / V2BusinessShareIntegration / V2BusinessReviewsIntegration | resident-application-v1 / business-share-v1 / business-reviews-v1 / shop-recommendations-v1 |

## 3. Required implementation

- Add baseline-comparison-based visual and interaction parity contract tests for the six screens above, reusing the existing `frontend/tests/v2-current-*-contract.mjs` style.
- Where the test exposes a drift point against the 20260904 handoff, apply only small corrective visual/interaction fixes in the corresponding V2 component.
- Design requirements reference (from R0): 24=글자크기/알림설정/개인정보·계정/약관/탈퇴, 25=내문의, 25A=가게등록+제보+확인서류+가게사진, 26=동호수/가족초대, 27=새알림, 28=나의활동.

## 4. Hard boundaries

- Do NOT touch auth, schemas, backend logic, or migrations.
- No backend changes at all on this track.
- Do not add screens 23 (이웃온기) or 03 (주민혜택 쿠폰); they are HOLD per policy (#139).

## 5. Completion gates

- frontend `npm run typecheck` (full parity) green
- frontend `test:v2-complex-news-contract` green
- frontend `npm run build` green
- Existing `v2-current-*-contract` 6 kinds regression green
- Excluded items (23 / 03) not added to code
- PR body: changed-file list, executed test results, last pushed commit hash.

## 6. Forbidden

- Auth / schema / backend / migration changes.
- Implementing 23 이웃온기 or 03 주민혜택 쿠폰.
- Production DB write/seed, production deploy.
- Secreting values in code/logs/issue/PR/chat.
- Merging PR or declaring `PRODUCTION_READY`.
