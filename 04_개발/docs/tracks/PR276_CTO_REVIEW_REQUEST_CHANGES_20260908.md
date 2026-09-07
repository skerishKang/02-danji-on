# PR #276 CTO REVIEW — REQUEST_CHANGES record

- Date: 2026-09-08
- PR: #276 `프론트엔드 v3 승격 — 이웃가게 B안 확정본 (백엔드 연결 기준)`
- Head: `6cbdb66fccac2d72dee78c712b687a15dbfeace6`
- Action taken: REQUEST_CHANGES submitted and PR converted back to Draft.

## Verdict

`DO_NOT_MERGE_CURRENT_HEAD`

PR #276 cannot be merged at the current head because it violates owner-decision HOLD boundaries and lacks exact-head validation evidence.

## Blockers

### 1. #263 violation — 23 이웃온기 score formula invented

The PR changes `frontend/23_이웃온기.html` and introduces concrete score/threshold policy:

- 게시글 작성 `+10`
- 가게 후기 작성 `+10`
- 댓글 작성 `+3`, daily max `9`
- 공감 보내기 `+1`, daily max `5`
- 받은 공감 `+1`
- 가게 주인 답글 `+5`
- LV.2 `30`, LV.3 `80`, LV.4 `160`, LV.5 `280`

This conflicts with #263, which explicitly keeps warmth/onki formula, event weights, and penalties on HOLD until owner decision.

Required fix:

- Remove score formula, level thresholds, weighting, and penalty language from `frontend/23_이웃온기.html`.
- Keep only non-committal level-only copy, or link to an owner-approved decision record.

### 2. 06/07 notice content repeats the same HOLD violation

The PR also adds level-score notice content in:

- `frontend/06_단지온공지_목록.html`
- `frontend/07_단지온공지_상세.html`

Required fix:

- Remove the level-score notice entry/content, or change it into a HOLD-neutral notice that does not define scoring, thresholds, weights, penalties, or formula.

### 3. PR body misstates changed files

PR body claims 9 changed files, but GitHub reports 20 changed files.

Required fix:

- Either narrow the PR to the actual v3 promotion files, or update the PR body to match the true changed-file set.

### 4. No exact-head validation evidence

No PR-triggered workflow run or status check was found for head `6cbdb66fccac2d72dee78c712b687a15dbfeace6`.

Required fix:

- Add exact-head validation evidence before re-review.
- Minimum expected evidence: HTML parse/static route check, v3 route target existence, 390×844 path smoke, and v1/v2 regression note.

### 5. HTML structure risk

`frontend/19_내정보_메인.html` patch shows style insertion after `</body>`.

Required fix:

- Move appended style/script blocks before closing `</body>`/`</html>` and run static parse validation.

## Re-review gate

A new PR #276 head can be re-reviewed only after:

1. #263 HOLD violation removed or owner decision record linked.
2. 06/07 level-score content removed or made policy-neutral.
3. PR body and actual changed-file list match.
4. Exact-head validation evidence is added.
5. HTML structure is cleaned.

## Current operational status

PR #276 has been converted to Draft to prevent accidental merge while these blockers remain unresolved.