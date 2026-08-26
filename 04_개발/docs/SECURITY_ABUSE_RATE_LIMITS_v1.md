# DanjiOn Security Abuse Rate Limits v1

Issue: #92  
Base: PR #91 exact green head `3484796a0542bf62d384b51725f6f0462e75be47`

## 1. Separation of concerns

Two independent rate-limit layers are used.

1. Better Auth `/api/auth/*`
   - Better Auth built-in global and sensitive-endpoint policies remain authoritative.
   - state is persisted through Better Auth database storage in `danjion_auth.rate_limit`.
   - connecting IP is read only from Cloudflare `cf-connecting-ip`.
2. DanjiOn high-abuse product writes
   - one atomic PostgreSQL fixed-window counter keyed by internal `app_users.id` + server action constant + window start.
   - no email, phone, building, unit, provider identity, resident-verification evidence, or client role header is a rate-limit key.

`RATE_LIMIT_PASS != AUTHORIZATION_PASS`

The product limiter runs before the existing bounded endpoint handlers. A successful counter consumption never grants Household, resident, owner, PADIEM, or council authority. Existing endpoint AuthZ runs afterward unchanged.

## 2. Initial product policies

| Action | Limit |
|---|---:|
| Community post create | 5 / 10 minutes |
| Community comment create | 30 / 10 minutes |
| Community report | 10 / hour |
| Family invite create | 10 / hour |
| Family invite redeem | 10 / hour |
| Business application create | 5 / 24 hours |
| Benefit claim | 30 / hour |

Only POST routes matching these actions are intercepted. Reads, PATCH/DELETE ownership flows, official-content administration, Community moderation, account closure, storage, and resident-verification administration are not broadened into this v1 policy.

## 3. Atomic product counter

Migration `018_security_abuse_rate_limits.sql` adds `product_mutation_rate_limits`.

The runtime consumes a bucket with one PostgreSQL data-modifying statement:

- compute the current fixed window server-side;
- remove the same actor/action's expired bucket;
- INSERT the current bucket;
- `ON CONFLICT` increments `request_count` atomically;
- return the current count and server-derived retry interval.

Counts through the configured maximum pass to the existing endpoint. The next request returns HTTP 429 with `Retry-After` and does not execute the downstream product mutation.

A database evaluation failure fails closed for these bounded mutation routes with `RATE_LIMIT_CHECK_FAILED`; it never silently bypasses the limit.

## 4. Better Auth database storage

`auth-better-v1.ts` configures:

- `rateLimit.storage = 'database'`
- `rateLimit.modelName = 'rateLimit'`
- `advanced.ipAddress.ipAddressHeaders = ['cf-connecting-ip']`

No custom Better Auth route rules are introduced here, so Better Auth's built-in sensitive endpoint rules and global production behavior are not replaced.

The Drizzle model maps Better Auth's `rateLimit` model to physical table `danjion_auth.rate_limit` with `id`, unique `key`, integer `count`, and PostgreSQL `bigint` `last_request`.

## 5. Deployment boundary

This change does not apply migration 018 to production and does not deploy any Worker or frontend. Before any future runtime deployment using this head, migration 018 must first be validated on an isolated Neon child branch and then moved through the separately approved production migration process.

Issue #59 remains HOLD. This security layer neither selects a resident-verification provider nor grants management-office/PADIEM/resident-council access to resident evidence or broad PII.
