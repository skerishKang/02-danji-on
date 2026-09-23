# QA R2 Storage Validation Harness (#909)

Remote-only runtime validation for the isolated QA Worker R2 storage lane.

## Commands

```bash
# Source contract (no network) — also runs in CI on harness paths
node 04_개발/backend/tests/qa-r2-storage-lane-contract.mjs

# Runtime harness (QA remote only; never local, never production)
DANJION_QA_API_URL=https://padiem-danjion-api-qa.padiem.workers.dev \
DANJION_QA_FRONTEND_URL=https://danjion-qa.pages.dev \
DANJION_QA_EMAIL=... \
DANJION_QA_PASSWORD=... \
node 04_개발/backend/tests/runtime-qa-r2-storage.mjs --remote
```

Or set `DANJION_QA_REMOTE=1` instead of `--remote`.

## Guarantees

- `REMOTE_ONLY=YES` — loopback/`--local` rejected before network
- `PRODUCTION_TARGET=DENY` — canonical production hosts fail closed
- Fixture/enum validation runs before any HTTP call
- Classifiers: PASS / APPLICATION_FAILURE / AUTH_FAILURE / RATE_LIMITED / INFRA_FAILURE / HARNESS_FAILURE
- Retries: bounded network + 5xx only; no retry on 401/403/429/4xx validation
- Secrets/tokens/cookies are never printed (bindings reported as READY only)
- Application 500s are reported as `APPLICATION_FAILURE`, never as credential failures
- `PRODUCTION_MUTATION=0`

## Workflow

`.github/workflows/qa-r2-storage-validation.yml`

- PR: source contract only
- `workflow_dispatch` + `run_live=true`: exact-main guard, then remote runtime harness (QA environment)
