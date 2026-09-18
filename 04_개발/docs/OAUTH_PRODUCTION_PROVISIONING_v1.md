# OAUTH PRODUCTION PROVISIONING v1 (Issue #422 diagnosis)

## Root cause (historical: 2026-09-12 live diagnosis)

Production probe of `https://padiem-danjion-api-production.padiem.workers.dev/api/auth/sign-in/social`
returned `PROVIDER_NOT_FOUND` (HTTP 404) for **all three** providers — `google`, `kakao`, `naver`.

This is not a Naver-specific defect. `configuredSocialProviders()` in
`04_개발/backend/src/auth-better-v1.ts` registers a provider only when both of its
Worker secrets are non-empty:

| Provider | Worker secret names (set by bootstrap) | Production environment secret names |
| --- | --- | --- |
| google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `DANJION_GOOGLE_CLIENT_ID`, `DANJION_GOOGLE_CLIENT_SECRET` |
| kakao | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | `DANJION_KAKAO_CLIENT_ID`, `DANJION_KAKAO_CLIENT_SECRET` |
| naver | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | `DANJION_NAVER_CLIENT_ID`, `DANJION_NAVER_CLIENT_SECRET` |

At the time of the 2026-09-12 probe, the production environment did not contain the
`DANJION_*_CLIENT_*` secrets. The bootstrap therefore skipped every provider and the
deployed Worker had an empty `socialProviders` map. This paragraph is historical and
does not describe the current production state.

## Current status (verified 2026-09-16)

Google, Kakao, and Naver OAuth are provisioned and registered on the production Worker.
The production environment contains all six provider secret names:

- `DANJION_GOOGLE_CLIENT_ID` / `DANJION_GOOGLE_CLIENT_SECRET`
- `DANJION_KAKAO_CLIENT_ID` / `DANJION_KAKAO_CLIENT_SECRET`
- `DANJION_NAVER_CLIENT_ID` / `DANJION_NAVER_CLIENT_SECRET`

The 2026-09-16 `Production Worker Bootstrap` completed successfully and its readback
reported `google`, `kakao`, and `naver` registration as `PASS`. Secret values never enter
git, issues, PRs, or chat.

better-auth is pinned at `1.7.1`, which ships built-in `naver` support; the Worker code,
`DANJION_AUTH_BASE_URL`, and `AUTH_TRUSTED_ORIGINS` (`https://danjion.pages.dev`) are already
correct. Nothing in the repository needs a code change to make Naver work.

## Provisioning procedure (historical reference; values stay out of git)

The procedure below is retained for credential rotation or a future provider re-provision.
It is not an outstanding Kakao setup task.

### Callback authority (updated 2026-09-15 — Stage 2 Pages auth facade)

Browser OAuth now runs through the Pages auth facade (`functions/_lib/auth-facade.js`;
contract: `frontend/tests/leaf-b14-stage2-same-origin-auth-cutover-contract.mjs`). The facade
proxies `/api/auth/*` and `/auth/social-start` from the canonical Pages origin to the Worker,
and the Worker's bounded public-base resolver mints provider callback URLs on
`https://danjion.pages.dev` for facade-originated requests. Provider apps must be registered
against the **canonical browser callback**:

```
CANONICAL_BROWSER_CALLBACK (register these in the provider consoles):
  https://danjion.pages.dev/api/auth/callback/google
  https://danjion.pages.dev/api/auth/callback/kakao
  https://danjion.pages.dev/api/auth/callback/naver

DIRECT_WORKER_BASE (internal/diagnostic traffic only — NOT the browser callback):
  https://padiem-danjion-api-production.padiem.workers.dev
```

The workers.dev callback URIs in the original 2026-09-12 text below are **stale for browser
OAuth**. They remain correct only for direct-Worker requests, which the public-base resolver
intentionally keeps on the Worker base (see `auth-facade-public-base-contract.mjs`).

1. Register the OAuth apps with the canonical browser callback URIs above — exact match,
   including `https`, host, and full path (Better Auth canonical form).
2. Naver Developer Console specifics (why Naver feels the strictest):
   - The Callback URI must match **exactly**, including `https`, host, and full path —
     no wildcards, no trailing-slash variance.
   - The app must pass Naver's 상세설정 (product apply / 승인) before production traffic;
     an `개발중` (Testing) app only works for whitelisted test users.
   - Scopes: `profile` (nickname) and `email` are required for account linking.
     Naver returns unverified-email fields for some accounts; DanjiOn links identities by email.
   - Kakao requires the Redirect URI registered in Kakao Developers (Kakao Login > Redirect URI)
     and is likewise exact-match. Use the canonical Pages callback
     `https://danjion.pages.dev/api/auth/callback/kakao`. Kakao treats the Client Secret as an
     app option: when it is enabled both `KAKAO_CLIENT_ID` and `KAKAO_CLIENT_SECRET` must be
     provisioned, because `configuredSocialProviders()` registers the provider only for a
     complete pair. Google authorized redirect URI must equal the canonical callback URL.
3. Create the six GitHub secrets in the **production environment** (or repo level) with the
   exact names from the table. Never paste values into issues, PRs, or chat.
4. Re-run `Production Worker Bootstrap` (`workflow_dispatch`, `confirm_production=true`).
   The workflow now prints `OAuth providers provisioned (names only): ...` and executes
   `Verify social provider registration on production Worker`, which fails closed if a
   provider has credentials but is not live on the Worker (`PROVIDER_NOT_FOUND`).
5. Verify from the browser on `https://danjion.pages.dev/` — the V3 login modal POSTs
   `{provider, callbackURL}` to `/api/auth/sign-in/social` and follows the returned `url`.

## Behavioral notes

- All providers run with `disableImplicitSignUp: true`: an unknown social identity must
  come through the signup lane (`requestSignUp: true`, which the V3 modal sends in signup
  mode); login-mode clicks for brand-new accounts are expected to be rejected by policy.
- With no provider configured, the V3 modal shows
  `소셜 인증을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.` — this toast plus a
  `PROVIDER_NOT_FOUND` response is the provisioning-missing signature, not a Naver outage.
- Post-callback completion for new social users is handled by
  `04_개발/backend/src/social-onboarding-v1.ts` (`/auth/social-onboarding/*`).
