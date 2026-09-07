# PR #271 HANDLING NOTE — 2026-09-08

PR #271 is a read-only 008 handoff delta inventory PR.

## Current disposition

Do not merge blindly.

## Reason

Its own body says it is a read-only CTO judgment artifact and not a merge target. It may still contain useful evidence, but the evidence location should be verified before closing.

## Recommended handling

1. Verify whether the report artifact from #271 already exists on main or has been superseded by later docs.
2. If preserved elsewhere, close #271 as not planned / superseded.
3. If not preserved, rescue only the useful report file in a fresh docs-only PR.

## Do not do

- Do not merge stale resume-state or forensic-only PRs simply because they are mergeable.
- Do not discard evidence before confirming it exists in main or a replacement doc.