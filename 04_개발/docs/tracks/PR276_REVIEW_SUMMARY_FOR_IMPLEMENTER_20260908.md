# PR #276 REVIEW SUMMARY FOR IMPLEMENTER — 2026-09-08

## One-line verdict

PR #276 has a good v3-promotion direction, but its current head must not merge because it defines owner-HOLD warmth/onki scoring.

## Fix in order

1. Remove all concrete onki score mechanics from `23_이웃온기.html`.
2. Remove/neutralize level scoring notice content from `06_단지온공지_목록.html` and `07_단지온공지_상세.html`.
3. Clean `19_내정보_메인.html` closing tag/style placement.
4. Reconcile PR body with actual changed files.
5. Add exact-head validation evidence.

## What can stay

- v3 routing branch concept.
- `index3.html` / `app3.html` entry concept.
- `01_이웃가게_발견_v3.html` as v3 shop surface.
- Owner-approved UI deltas that do not invent product policy.

## What must not stay

- Any concrete numbers for warmth/onki scoring.
- Any claim that specific activity types produce specific score values.
- Any level threshold numbers.
- Any score penalty/cap/abuse adjustment mechanics.

## Re-review condition

Return the PR to Ready for Review only after the above is fixed and the PR body includes exact head SHA validation evidence.