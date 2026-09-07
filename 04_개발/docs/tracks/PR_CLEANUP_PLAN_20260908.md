# PR CLEANUP PLAN — 2026-09-08

## Current open PRs after PR #275 merge

### #276 — frontend v3 promotion

Disposition: keep open as Draft; do not merge.

Reason: current head violates #263 HOLD and lacks validation evidence.

Next: implementer must remove score formula and re-request review.

### #273 — sibling latest delta report

Disposition: close after this rescue PR lands.

Reason: stale/unmergeable; useful report content is rescued here without stale resume-state edits.

### #271 — 008 handoff delta inventory

Disposition: leave open for now unless its artifact is known to be preserved elsewhere.

Reason: body says read-only and not for merge. Closing is safe later, but do not discard evidence until referenced report location is verified.

## Rule

Do not merge read-only forensic/report PRs merely because they are mergeable. Preserve the report artifact first, then close as superseded/not planned when appropriate.