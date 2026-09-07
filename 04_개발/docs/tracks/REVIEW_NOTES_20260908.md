# REVIEW NOTES — 2026-09-08

## PR #276 issue spotted from changed files

PR body claimed 9 files, but the actual PR changed 20 files. The expanded changed-file set included `frontend/23_이웃온기.html`, which triggered a HOLD-boundary review.

## Main blocker

The PR added concrete warmth/onki scoring information that had not been approved by owner decision.

This was not a small copy edit. It changed product policy semantics by defining activity scores and level thresholds.

## Correct handling

The correct handling was to block the PR, not to merge and fix later.

Actions taken:

- REQUEST_CHANGES review submitted.
- PR converted to Draft.
- Blockers documented in repository docs.
- Implementer repair prompt added.

## Why no direct code repair here

Without local checkout and static/browser validation, direct HTML surgery on a 20-file PR branch would be unsafe. The reliable path is a bounded implementer fix with exact-head validation evidence.