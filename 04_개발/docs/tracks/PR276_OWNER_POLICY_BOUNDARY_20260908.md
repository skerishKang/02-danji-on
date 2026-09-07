# PR #276 OWNER POLICY BOUNDARY — 2026-09-08

## Boundary

Frontend v3 promotion can proceed only inside already-approved UX deltas.

It cannot decide new product policy.

## Specifically forbidden in PR #276

- Defining warmth/onki score math.
- Defining LV thresholds.
- Defining scoring event weights.
- Defining daily caps.
- Defining abuse or penalty adjustment rules.
- Publishing notice content that presents the above as product fact.

## Allowed in PR #276

- Introduce `index3.html` and `app3.html` as v3 entry points.
- Introduce `01_이웃가게_발견_v3.html` as the v3 shop surface.
- Add v3 routing branch where route targets exist.
- Preserve v1/v2 behavior.
- Add owner-approved visual/copy deltas already within scope.

## Re-review

Once the policy-creating content is removed and validation evidence is added, PR #276 can be re-reviewed.