## Change summary

Describe the user-visible or operational change.

## Scope

- Base main SHA:
- Branch:
- Expected changed areas:
- Production mutation in this PR: **NO**

## Validation

- [ ] Fresh main read before work
- [ ] Relevant tests added/updated
- [ ] Exact-head CI reviewed
- [ ] Overlap with current main/open PRs checked
- [ ] No secret values in logs/source
- [ ] No Production mutation/deploy performed

## CENTRAL integration authority

```text
CENTRAL_MERGE_AUTHORIZED=NO
CENTRAL_AUTHORIZED_HEAD_SHA=UNSET
PRODUCTION_AUTHORIZED=NO
```

Delegated developers/secondary agents stop at Draft PR + CI/QA. CENTRAL updates the exact merge markers only after fresh drift review and exact-head GREEN.

See `docs/operations/CENTRAL_CHANGE_CONTROL.md`.
