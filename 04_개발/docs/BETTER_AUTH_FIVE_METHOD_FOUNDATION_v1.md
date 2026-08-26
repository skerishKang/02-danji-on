# DanjiOn Better Auth Five-Method Foundation v1

Date: 2026-08-26

## Account methods

One canonical Danjion account can authenticate through:

1. Kakao OAuth
2. Naver OAuth
3. Google OAuth
4. phone number + password
5. email + password

The phone credential is implemented with Better Auth's username plugin. The Korean mobile number is normalized to digits and used as the username. This v1 foundation does **not** use the phone-number/OTP plugin and does not claim that a phone number has been verified.

A canonical email is required when a password account is created. Email delivery and password-reset delivery are separate operational integrations and are not enabled by this foundation.

## Authority boundaries

```text
ACCOUNT_AUTHENTICATED
!= PHONE_VERIFIED
!= VERIFIED_RESIDENT
!= PADIEM_OPERATOR
```

`danjion_auth.*` owns account/session/provider credentials only.

`public.app_users` is the product identity bridge. The Better Auth JWT `sub` becomes `app_users.auth_user_id`, so multiple linked credentials resolve to one product user.

Resident/household authorization stays in the Danjion application tables and APIs. No authentication provider can create `VERIFIED_RESIDENT` by itself.

## Neon schema boundary

The Danjion Neon project already has the managed `neon_auth` schema. It is treated as Neon-owned and is not modified by migration 014.

Self-hosted Better Auth uses a separate PostgreSQL schema:

```text
danjion_auth.user
danjion_auth.session
danjion_auth.account
danjion_auth.verification
danjion_auth.jwks
```

Sandbox validation was performed only on the Neon child branch:

- project: `old-shape-61609481`
- child branch: `better-auth-five-method-sandbox-20260826`
- branch id: `br-weathered-violet-azkk0aiz`
- parent: production `br-bold-sun-azurylwi`

Migration 014 executed successfully on that child and all five Better Auth tables were confirmed. Production was not migrated.

## Runtime boundary

Cloudflare Worker owns `/api/auth/*` through Better Auth before the normal application JSON payload policy. `nodejs_compat` is enabled for Better Auth's AsyncLocalStorage dependency.

Product APIs continue to use the existing `requireActor()` boundary. When `DANJION_AUTH_BASE_URL` is configured, it verifies Better Auth JWTs through `/api/auth/jwks`. Historical managed Neon Auth JWT verification remains a fallback during migration.

OAuth secrets and `BETTER_AUTH_SECRET` are server-only Cloudflare secrets. They must never be exposed through Vite environment variables.

## HOLD / not included

- production migration 014
- production deployment
- OAuth provider credentials
- Kakao Biz App approval/email scope
- email sender/password reset sender
- real resident-verification provider
- automatic account merging by matching email alone
- SMS OTP or phone ownership verification

Social accounts that do not return the canonical email must go through an explicit account-completion/linking policy later; the system must not invent an email or merge users from mutable/unverified profile values.
