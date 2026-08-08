# TRACK E — LIVE STACK INTEGRATION WORK ORDER

## 1. Mission

Compose the completed Track A/B/C/D branches into one integration branch without reimplementing their features. Resolve only integration conflicts and make the combined branch pass all non-production gates.

Repository: `skerishKang/02-danji-on`
Branch: `feat/live-stack-integration`
Issue: #21

This branch starts from Track A head:
`011950fe20b16e38869092eaaa4b945ae69e7be2`

## 2. Immutable inputs

- Track A / PR #17 / `feat/live-neon-auth` @ `011950fe20b16e38869092eaaa4b945ae69e7be2`
- Track B / PR #18 / `feat/cloudflare-preview` @ `94633a11a4633d386e87591141072f7d03f7e918`
- Track C / PR #19 / `feat/google-drive-storage` @ `3a653310317bbfd6543163a992ed46e1c58eafc8`
- Track D / PR #20 / `feat/live-integration-gate` @ `93da53cc0b15044318154a589ddba9ff286e8ec7`

Do not silently substitute newer sibling heads. If any head moved, stop and report the mismatch before integrating it.

## 3. Required integration order

1. Keep Track A as canonical base.
2. Integrate Track C.
3. Resolve storage authentication logical conflict.
4. Integrate Track B.
5. Resolve `app.ts` and env/config overlaps by preserving both behaviors.
6. Integrate Track D last.
7. Run all existing CI/test gates.

## 4. Mandatory logical fix: Track C storage auth

Track C `04_개발/backend/src/storage-v1.ts` was implemented against the pre-Track-A auth boundary and contains its own `actorFromRequest` / `AUTH_ADAPTER_PENDING` path.

This MUST NOT survive integration.

Required final state:

- import and use Track A canonical `requireActor` from `src/auth-v1.ts`;
- do not duplicate JWT/JWKS parsing in storage;
- do not retain `AUTH_ADAPTER_PENDING` in storage;
- production dev-header bypass remains impossible;
- storage upload/private read/delete use the same authenticated product actor as every other private API;
- Drive private evidence authorization remains: uploader OR verified manager/admin for the same complex;
- public business media proxy remains anonymously readable only through the DanjiOn backend route.

If this is not true, Track E is FAIL.

## 5. Expected overlap resolution

### `04_개발/backend/src/app.ts`
Final file must contain BOTH:
- Track C `handleStorageRequest` routing;
- Track B CORS allowlist / preflight / response wrapping.

Do not drop existing admin/resident/benefit/application handlers.

### `04_개발/backend/.dev.vars.example`
Union A+B+C runtime placeholders. Never add real secrets.

Expected categories include:
- database/app env
- Neon Auth runtime/JWKS
- Cloudflare preview/CORS where applicable
- Google Drive storage OAuth/folder config

### `04_개발/backend/package.json`
Preserve Track A auth dependency/test scripts and Track C storage dependency/test scripts.

### `04_개발/frontend/.env.example`
Preserve Track B preview API/data mode and Track C storage mode values.

## 6. Neon preview DB contract

Do NOT use production `DATABASE_URL` for preview/live testing.

Use the Padiem / Danjion child branch created for preview:

- branch name: `cloudflare-preview-20260808`
- branch id: `br-hidden-frog-azdevrqe`
- parent production: `br-bold-sun-azurylwi`
- schema diff vs production: empty at creation
- application rows: zero at creation

The actual connection string is a secret and must never be committed or printed into PR/issues.

## 7. Track D

Track D changed-file overlap with A/B/C was zero at coordinator review. Integrate it last and preserve its fail-closed behavior.

Do not make blocked live gates fake-pass. Static/non-live gates may pass; live gates remain BLOCKED until real external secrets/runtime configuration exists.

## 8. Validation required

At minimum:

- backend typecheck
- backend full check/contract/auth/storage tests
- frontend typecheck/build
- existing Playwright E2E
- Resident Verification CI
- Pre-Infra Integration CI
- Track D static Live Release Gate

Also add an integration assertion proving storage no longer contains `AUTH_ADAPTER_PENDING` and uses the Track A auth resolver.

## 9. Hard safety rules

- NO merge to main or any parent PR.
- Keep PR Draft.
- NO Cloudflare production deployment.
- NO production database test writes or seed.
- NO production Google Drive write.
- NO R2.
- NO secrets in repository, logs, issue body, or PR body.
- Do not delete the pre-migration Neon snapshot branch.

## 10. Deliverable

Update the Track E Draft PR body with:

- exact sibling heads integrated;
- conflict resolutions performed;
- final storage auth architecture;
- changed files summary;
- CI/test evidence;
- live dependencies still blocked;
- production write/deploy status;
- final integration verdict: `INTEGRATION_GREEN` or `INTEGRATION_BLOCKED`.

Do not mark Ready for Review and do not merge.
