# NEXT IMPLEMENTER PROMPT — PR #276 fix

Use this prompt for the next local/implementer session that can modify the PR #276 branch.

## Target

Repository: `skerishKang/02-danji-on`
PR: #276
Branch: `release/frontend-v3-20260906`
Current bad head: `6cbdb66fccac2d72dee78c712b687a15dbfeace6`

## Objective

Repair PR #276 so the frontend v3 promotion can be reviewed without violating HOLD policies.

## Required changes

1. Remove invented onki/warmth score mechanics from `frontend/23_이웃온기.html`.
   - Remove concrete score values.
   - Remove daily max values.
   - Remove LV threshold numbers.
   - Remove penalty/abuse adjustment language unless already approved by owner decision record.
   - Keep only level-only, policy-neutral, non-scoring copy.

2. Remove or neutralize level-score notice content in:
   - `frontend/06_단지온공지_목록.html`
   - `frontend/07_단지온공지_상세.html`

3. Clean HTML structure in `frontend/19_내정보_메인.html`.
   - Do not append `<style>` after `</body>`.
   - Ensure only valid closing structure remains.

4. Update PR body.
   - Actual changed files must match the PR body.
   - If 20 files remain, list all 20 and justify why each is in scope.
   - Prefer narrowing the PR to the minimum v3 promotion surface.

5. Add validation evidence to PR body.
   - Exact head SHA.
   - Static HTML parse / closing tag check.
   - Route target existence check, especially v3 paths.
   - 390×844 smoke route summary.
   - Regression note for v1/v2 behavior.

## Do not change

- Do not resolve #263 by inventing a score formula.
- Do not add migrations or backend schema for warmth/onki.
- Do not resolve #253/#139 benefit delivery-mode by inference.
- Do not change #59 privacy/resident verification/admin boundary.
- Do not deploy production.
- Do not merge PR #276 from the implementer session.

## Report format

```text
PR276_FIX_REPORT
HEAD_BEFORE=<sha>
HEAD_AFTER=<sha>
FILES_CHANGED=<list>
HOLD_VIOLATION_REMOVED=YES/NO
HTML_STRUCTURE_CHECK=PASS/FAIL
ROUTE_TARGET_CHECK=PASS/FAIL
V1_V2_REGRESSION_NOTE=<summary>
READY_FOR_REVIEW=YES/NO
```
