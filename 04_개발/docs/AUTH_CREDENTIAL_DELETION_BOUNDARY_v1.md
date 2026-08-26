# DanjiOn Auth Credential Deletion Boundary v1

Issue: #88

## Purpose

Separate DanjiOn product-account closure from Better Auth credential deletion while making the sequence safe and explicit.

## Required order

```text
1. POST /api/v1/me/account/close
   -> app_users.account_status = closed
   -> household/operator/product authorization revoked

2. Better Auth delete-user flow
   -> password, fresh-session, or delete-verification checks remain Better Auth owned
   -> beforeDelete verifies the DanjiOn product account is already closed
   -> danjion_auth.user hard delete
   -> danjion_auth.session/account rows cascade
```

An active or missing DanjiOn product account fails the Better Auth `beforeDelete` gate.

## Email verification

OAuth/fresh-session deletion verification uses the existing server-side auth email relay with the new `delete-account` message kind. Provider credentials remain server-only.

## Data disposition

Better Auth identity/session/link rows may be deleted after the product account is closed. The anonymized closed `app_users` record remains so existing audit, consent and historical product records keep a stable internal reference. This document does not claim or define a legal retention period.

## Invariants

- `PRODUCT_ACCOUNT_ACTIVE -> AUTH_HARD_DELETE_DENY`
- `PRODUCT_ACCOUNT_CLOSED -> BETTER_AUTH_DELETE_MAY_PROCEED`
- `BETTER_AUTH_USER_DELETED -> AUTH_SESSIONS_AND_LINKED_ACCOUNTS_DELETED`
- valid external/JWT credentials never restore a closed DanjiOn product account
- auth deletion never grants or changes resident verification

## Hard boundaries

- no frontend/UI work in this change
- no production migration/write
- no production deploy
- no provider app secret changes
- no managed `neon_auth` mutation
- no resident-verification policy decision
