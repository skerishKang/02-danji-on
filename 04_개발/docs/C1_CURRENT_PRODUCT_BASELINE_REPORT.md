# DanjiOn C1 Current Product Baseline Report

Date: 2026-08-26
Issue: #46
PR: #47
Status: IN PROGRESS — exact-head CI required

## Candidate branch

```text
feat/current-product-baseline-20260826
```

Started from:

```text
d9288a255d2eefe230b8602f7d92aa5f32cc2d60
```

The branch does not use stale `main` as a source base.

## Incorporated backend/live input

The post-Track-E safety delta from:

```text
11ed911aadbe2a4d641de67ccbcd7984118b8b9e
```

has been manually reconciled into the V2-derived line, preserving V2 workflow scoping.

Reconciled surfaces:

- `.github/workflows/cloudflare-preview.yml`
- `04_개발/backend/package.json`
- `04_개발/backend/tests/cloudflare-preview-contract.mjs`

## Current Product Shell authority

Google Drive authority remains:

```text
13_공식런칭_시네마틱모션통합_v1.3
```

Current visible 5-view IA:

```text
홈 / 이웃가게 / 혜택 / 우리단지 / 내정보
```

The former V2 visible `주민혜택 / 단지소식` labels are not current product authority.

## React C1 port

Added a bounded Product Shell port for `우리단지`:

- current tabs and resident write kinds
- nickname-only presentation
- like/comment/report UI semantics
- first-post review UI behavior
- resident-only locked state
- current privacy/safety copy

This is deliberately mock/UI semantics only. It is not Community persistence and it is not the final C5 route/repository implementation.

## Authorization boundary

Authentication:

```text
existing auth-v1.ts JWT -> app_users actor
= reuse candidate
```

Authorization:

```text
Resident membership != PADIEM operator authority
```

Staged contract:

```text
04_개발/docs/CURRENT_AUTHORIZATION_CONTRACT_v2.md
```

Reserved migration ordering:

```text
009 household foundation
010 household invite/family lifecycle
011 consent + authorization audit
012 PADIEM operator grants
013 earliest Community core slot, re-check required
```

No migration is applied by C1.

## Required verdict

This report may be promoted to:

```text
CURRENT_PRODUCT_BASELINE_READY
```

only after exact-head CI verifies the branch and the staged authorization/migration contract is accepted as the pre-C2 boundary.

Otherwise:

```text
CURRENT_PRODUCT_BASELINE_BLOCKED
```

## Safety

- production deploy: NONE
- production DB mutation/seed: NONE
- migrations 001–008: unchanged
- Community DB tables: NONE
- production Drive write: NONE
- R2: NONE
- PR merge: NONE
