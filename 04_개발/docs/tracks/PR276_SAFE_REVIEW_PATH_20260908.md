# PR #276 SAFE REVIEW PATH — 2026-09-08

## Step 1 — reduce scope

Prefer limiting PR #276 to:

- `frontend/index3.html`
- `frontend/app3.html`
- `frontend/01_이웃가게_발견_v3.html`
- required v3 routing changes in shared navigation files
- README update matching actual files

## Step 2 — remove policy content

Remove score/threshold/cap/penalty content from:

- `frontend/23_이웃온기.html`
- `frontend/06_단지온공지_목록.html`
- `frontend/07_단지온공지_상세.html`

## Step 3 — validate

At minimum:

```text
HTML_PARSE_CHECK=PASS
ROUTE_TARGET_EXISTENCE=PASS
V3_390x844_SMOKE=PASS
V1_V2_REGRESSION=PASS_OR_NOT_AFFECTED
HEAD_SHA=<new sha>
```

## Step 4 — update PR body

PR body must state:

- actual changed files
- why each file is in scope
- validation evidence
- explicit no-HOLD-policy-change statement

## Step 5 — re-review

Only then mark Ready for Review.