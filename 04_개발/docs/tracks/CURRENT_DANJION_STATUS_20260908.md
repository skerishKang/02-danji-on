# CURRENT DANJION STATUS — 2026-09-08

## Repository

- Repo: `skerishKang/02-danji-on`
- Default branch: `main`
- Latest known baseline before this branch: PR #275 merged as `4d1dc56`

## Completed

1. Production Go-Live had previously completed with DB/Worker/JWKS/health checks reported green.
2. PR #274 imported `muphobia2/danjion @1098e77` as a root 1:1 mirror.
3. PR #275 updated CTO resume state and added sibling workspace guidance.
4. Track F/G/H/K work from #246/#257/#267 series had already been merged before the sibling import.

## Active / not complete

### PR #276 — frontend v3 promotion

Status: `DRAFT / REQUEST_CHANGES / DO_NOT_MERGE_CURRENT_HEAD`

Reason:

- The PR introduces concrete `23_이웃온기` score formula and LV thresholds, violating #263 HOLD.
- It also adds 06/07 notice content describing the same level-score mechanics.
- PR body says 9 changed files, actual PR has 20 changed files.
- No exact-head CI/status evidence was found.
- HTML structure risk was found in `19_내정보_메인.html`.

Required next work:

- Remove warmth/onki score formula and level threshold definitions from #276.
- Remove or neutralize 06/07 level-score notice content.
- Update PR body to match actual changes.
- Add exact-head validation evidence.

### PR #273 — sibling latest delta report

Status: stale/unmergeable after PR #275.

Disposition:

- Do not merge #273 as-is.
- Preserve only the useful delta report via replacement branch/PR.
- Close #273 as superseded after replacement lands.

### PR #271 — 008 handoff delta inventory

Status: draft/read-only report, body says not for merge.

Disposition:

- Keep as reference or close as not planned after confirming its report is already preserved elsewhere.
- Do not merge blindly.

## Open HOLD issues

- #263 — 이웃온기 score formula / 주민혜택 delivery-mode / R1 exclusions.
- #253 — 03 주민혜택 delivery-mode policy unresolved.
- #235 — KakaoTalk phone verification delivery HOLD.
- #139 — backend handoff low-priority owner policy decisions.
- #59 — privacy, resident verification, and admin access legal/operational gate.

## Open active/backlog issues

- #222 — real account signup/login entry and Danjion session bridge.
- #245 — post-V2 stabilization refactor wave.

## Recommended next sequence

1. Merge this docs-only rescue/status PR.
2. Close/supersede PR #273.
3. Leave PR #276 draft until the implementer removes HOLD-violating onki score mechanics.
4. Re-review PR #276 only after exact-head validation evidence is added.
5. Do not touch #263/#253/#139/#59 HOLD decisions without owner policy input.