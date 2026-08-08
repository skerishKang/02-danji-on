# DanjiOn Cloudflare Preview Deployment — 2026-08-08

## Scope

이 문서는 Track B의 Cloudflare preview 배포 설계를 Track E 통합 브랜치에 적용하는 기준이다. production deploy와 PR merge는 수행하지 않는다.

Track B 고정 입력은 `feat/cloudflare-preview@94633a11a4633d386e87591141072f7d03f7e918`이다. Track E에서는 같은 preview-only 원칙을 유지하되 branch/alias와 database secret 계약만 통합 브랜치에 맞게 조정한다.

## Cloudflare resources

### Worker preview

- Wrangler environment: `preview`
- Worker resource name: `padiem-danjion-api-preview`
- Track E preview alias: `track-e`
- Publish method: `wrangler versions upload --env preview --preview-alias track-e`
- Active production traffic deployment: 없음

`wrangler versions upload`는 새 Worker version과 preview URL을 생성하지만 production traffic에는 활성 배포하지 않는다.

### Frontend preview

- Cloudflare Pages project: `padiem-danjion-web-preview`
- Pages production branch metadata: `main`
- Track E preview deployment branch: `track-e`
- Stable branch preview alias after successful deployment: `https://track-e.padiem-danjion-web-preview.pages.dev`
- Production Pages deployment: 없음

Workflow는 반드시 `--branch=track-e`로만 Pages deploy를 실행한다.

## Required GitHub Actions secrets

Track E preview에는 다음 값이 필요하다.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `DANJION_PREVIEW_DATABASE_URL`

`DANJION_PREVIEW_DATABASE_URL`은 반드시 Issue #21에서 고정한 Neon preview child branch를 가리켜야 한다.

- Project: Padiem / Danjion
- Preview child branch: `cloudflare-preview-20260808`
- Branch ID: `br-hidden-frog-azdevrqe`
- Parent production: `br-bold-sun-azurylwi`

production connection string을 preview secret으로 사용하지 않는다. 실제 secret 값은 repository 파일, PR body, workflow log에 기록하지 않는다.

Workflow는 `${RUNNER_TEMP}`의 일회성 secret file에 preview child `DATABASE_URL`을 넣어 `wrangler versions upload --secrets-file`로 암호화된 Worker version secret에 주입한다.

## Worker environment separation

`04_개발/backend/wrangler.jsonc`:

### development

- `APP_ENV=development`
- local Vite origin만 CORS 허용
- `.dev.vars`에서 로컬 DB 및 local-only auth bypass 설정 가능

### preview

- `APP_ENV=preview`
- `DEV_AUTH_BYPASS=false`
- CORS는 `*.padiem-danjion-web-preview.pages.dev`만 허용
- `preview_urls=true`
- `workers_dev=false`
- `DATABASE_URL`은 preview child encrypted secret

### production

- `APP_ENV=production`
- `DEV_AUTH_BYPASS=false`
- `CORS_ALLOWED_ORIGINS` 기본 공백
- `preview_urls=false`
- `workers_dev=false`
- Track E에서는 deploy하지 않음

## Frontend preview build

Cloudflare preview workflow의 public-shell smoke build는 다음을 사용한다.

```text
VITE_DATA_MODE=api
VITE_AUTH_MODE=dev
VITE_STORAGE_MODE=mock
VITE_API_BASE_URL=<Worker preview URL>
VITE_COMPLEX_SLUG=bangnim-myeongji-roadhill
```

Vite production build에서는 `x-danjion-dev-auth-user`가 `import.meta.env.DEV` guard 때문에 전송되지 않으므로 preview에서 dev bypass를 열지 않는다. Track A의 실제 Bearer/JWKS 검증과 Track C Drive file flow는 Track D live gate의 별도 runtime credentials로 검증한다.

## Preview workflow

File: `/.github/workflows/cloudflare-preview.yml`

Track E hard guards:

- head branch가 `feat/live-stack-integration`
- Worker env가 `preview`
- Pages branch가 `track-e`이며 `main`이 아님
- required secret이 없으면 Cloudflare upload 전에 실패
- DB secret은 `DANJION_PREVIEW_DATABASE_URL`로 production secret과 이름부터 분리

Sequence:

1. backend install/check
2. frontend install/typecheck
3. Worker preview version upload
4. Worker preview URL 추출
5. frontend production build
6. bundle에 Worker URL 주입 확인
7. Pages project 존재 확인
8. `track-e` Pages preview deploy
9. `/api/health` + DB read-only smoke
10. frontend URL smoke
11. frontend Origin CORS 확인
12. OPTIONS preflight 확인
13. GitHub job summary 기록

## Health contract

성공 조건:

```json
{
  "data": {
    "status": "ok",
    "database": "ok"
  }
}
```

이 check는 destructive query나 seed를 실행하지 않는다.

## Security / boundaries

- migration `001`~`008`: 변경 없음
- production seed/write: 없음
- production DB connection string을 Track E preview에 사용하지 않음
- production Worker deploy: NONE
- production Pages deploy: NONE
- production Drive write: NONE
- R2: 사용하지 않음
- PR merge: NONE

## Current execution state

코드 통합 단계에서는 Cloudflare/Neon preview credentials를 임의 생성하거나 production 값을 재사용하지 않는다. 외부 secret이 준비되지 않은 경우 Cloudflare Preview는 deploy 전에 BLOCKED가 정상 상태다.

Track E의 코드 통합 판정은 Backend/Frontend/Resident Verification/Pre-Infra/Track D static gate를 기준으로 하며, 실제 Cloudflare preview/live gate는 외부 설정 이후 별도로 수행한다.
