# CENTRAL change-control contract

This repository is operated with a single integration authority for `main`.

## Roles

### Delegated developer / secondary agent

A delegated developer may:

- fresh-read `main` before starting work;
- create or update its own feature/fix branch;
- open a **Draft PR**;
- run CI/QA and fix its own branch;
- leave implementation notes and handoff evidence.

A delegated developer must **not**:

- mark its own PR Ready for merge unless CENTRAL has authorized that exact head;
- merge, squash-merge, or rebase-merge into `main`;
- push directly to `main`;
- force-push or rebase shared branches;
- dispatch Production mutation/deploy workflows without separate Production authority;
- revert an unexpected `main` change automatically.

### CENTRAL

CENTRAL alone performs the integration sequence:

1. fresh-read current `main`, open PRs/issues, exact-head CI, and relevant workflow state;
2. compare the candidate branch against the **current** `main`;
3. inspect overlaps with other open work and any intervening main drift;
4. require exact-head CI GREEN;
5. write the exact authorization markers into the PR body;
6. mark Ready and merge with expected-head protection;
7. verify post-merge exact-main CI;
8. only then consider a separate Production gate.

## Required PR authorization markers

Every PR targeting `main` uses these literal markers:

```text
CENTRAL_MERGE_AUTHORIZED=NO
CENTRAL_AUTHORIZED_HEAD_SHA=UNSET
PRODUCTION_AUTHORIZED=NO
```

A Draft PR may remain `NO/UNSET` while development and CI proceed.

Immediately before Ready/Merge, CENTRAL changes only the merge markers to:

```text
CENTRAL_MERGE_AUTHORIZED=YES
CENTRAL_AUTHORIZED_HEAD_SHA=<exact PR head SHA>
```

`PRODUCTION_AUTHORIZED` remains `NO` unless a separate bounded Production authority explicitly exists. A merge authorization never implies Production authority.

## Unexpected main drift

If `main` changes while another PR is in progress:

- do not overwrite or revert it automatically;
- treat the new `main` as the new source of truth;
- compare changed files and semantic overlap;
- preserve unrelated merged work;
- reconcile the pending branch onto the fresh state without rebase/force-push;
- rerun exact-head CI before Ready/Merge.

## Production boundary

A successful merge or Review/Preview deploy is not a canonical Production release.

Production mutation/deploy must keep using explicit exact-main, confirmation, secret-output, and bounded-mutation gates already defined by the Production workflows.

## Hard-separation limitation

Repository automation can make unauthorized merges visible and can provide a required status check, but all tools acting through the same GitHub account have the same GitHub identity. True cryptographic separation between CENTRAL and another agent requires a distinct GitHub identity/team or another protected approval identity. Until then, this contract plus the governance workflow is the repository-level audit boundary.
