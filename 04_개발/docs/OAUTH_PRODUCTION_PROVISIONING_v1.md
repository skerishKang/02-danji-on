# OAUTH PRODUCTION PROVISIONING v1 (Issue #422 diagnosis)

## Root cause (2026-09-12 live diagnosis)

Production probe of `https://padiem-danjion-api-production.padiem.workers.dev/api/auth/sign-in/social`
returned `PROVIDER_NOT_FOUND` (HTTP 404) for **all three** providers — `google`, `kakao`, `naver`.

This is not a Naver-specific defect. `configuredSocialProviders()` in
`04_개발/backend/src/auth-better-v1.ts` registers a provider only when both of its
Worker secrets are non-empty:

| Provider | Worker secret names (set by bootstrap) | GitHub secret names (must be created by owner) |
| --- | --- | --- |
| google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `DANJION_GOOGLE_CLIENT_ID`, `DANJION_GOOGLE_CLIENT_SECRET` |
| kakao | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | `DANJION_KAKAO_CLIENT_ID`, `DANJION_KAKAO_CLIENT_SECRET` |
| naver | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | `DANJION_NAVER_CLIENT_ID`, `DANJION_NAVER_CLIENT_SECRET` |

As of 2026-09-12 the GitHub repository secrets are only `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `DANJION_PREVIEW_DATABASE_URL`, and the
`production` environment secret is only `DANJION_PRODUCTION_DB_URL`. No `DANJION_*_CLIENT_*`
secret exists anywhere, so `add_optional_pair` in `production-worker-bootstrap.yml`
skipped every provider silently and the deployed Worker has an empty `socialProviders` map.

better-auth is pinned at `1.7.1`, which ships built-in `naver` support; the Worker code,
`DANJION_AUTH_BASE_URL`, and `AUTH_TRUSTED_ORIGINS` (`https://danjion.pages.dev`) are already
correct. Nothing in the repository needs a code change to make Naver work.

## Owner provisioning procedure (values stay out of git)

1. Register the OAuth apps with these exact redirect/callback URIs (Better Auth canonical form):
   - `https://padiem-danjion-api-production.padiem.workers.dev/api/auth/callback/google`
   - `https://padiem-danjion-api-production.padiem.workers.dev/api/auth/callback/kakao`
   - `https://padiem-danjion-api-production.padiem.workers.dev/api/auth/callback/naver`
2. Naver Developer Console specifics (why Naver feels the strictest):
   - The Callback URI must match **exactly**, including `https`, host, and full path —
     no wildcards, no trailing-slash variance.
   - The app must pass Naver's 상세설정 (product apply / 승인) before production traffic;
     an `개발중` (Testing) app only works for whitelisted test users.
   - Scopes: `profile` (nickname) and `email` are required for account linking.
     Naver returns unverified-email fields for some accounts; DanjiOn links identities by email.
   - Kakao requires the Redirect URI registered in Kakao Developers (Kakao Login > Redirect URI)
     and is likewise exact-match. Google authorized redirect URI must equal the callback URL above.
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
