# DanjiOn Cloudflare Preview Deployment — 2026-08-08

## Scope

Track B (`feat/cloudflare-preview`, Issue #14, Draft PR #18) 전용 Cloudflare preview 배포 기준이다.

이 문서는 preview 배포만 다룬다. production deploy와 PR merge는 이 트랙에서 수행하지 않는다.

## Cloudflare resources

### Worker preview

- Wrangler environment: `preview`
- Worker resource name: `padiem-danjion-api-preview`
- Preview alias: `track-b`
- Publish method: `wrangler versions upload --env preview --preview-alias track-b`
- Active production traffic deployment: 없음

`wrangler versions upload`는 새 Worker version과 version preview URL을 생성하지만 그 version을 production traffic에 활성 배포하지 않는다.

### Frontend preview

- Cloudflare Pages project: `padiem-danjion-web-preview`
- Pages production branch metadata: `main`
- Preview deployment branch: `track-b`
- Stable branch preview alias: `https://track-b.padiem-danjion-web-preview.pages.dev`
- Production Pages deployment: 없음

Workflow는 반드시 `--branch=track-b`로만 Pages deploy를 실행한다.

## Required GitHub Actions secrets

Repository Actions secrets에 다음 3개가 필요하다.

- `CLOUDFLARE_API_TOKEN`
  - Padiem Cloudflare Account의 Worker/Pages preview 리소스를 만들고 version/direct-upload를 수행할 최소 권한 token
- `CLOUDFLARE_ACCOUNT_ID`
  - Padiem Cloudflare Account ID
- `DATABASE_URL`
  - Padiem Neon `Danjion` production branch connection string

Secret 값은 repository 파일, PR body, workflow log에 기록하지 않는다.

Workflow는 `${RUNNER_TEMP}`에 일회성 secret file을 만들고 `wrangler versions upload --secrets-file`로 `DATABASE_URL`을 암호화된 Worker version secret으로 업로드한다. runner 종료 후 파일은 폐기된다.

## Worker environment separation

`04_개발/backend/wrangler.jsonc`의 환경은 다음과 같이 분리한다.

### development

- `APP_ENV=development`
- local Vite origin만 CORS 허용
- `.dev.vars`에서 로컬 DB 및 개발 auth bypass를 설정 가능

### preview

- `APP_ENV=preview`
- `DEV_AUTH_BYPASS=false`
- CORS는 `*.padiem-danjion-web-preview.pages.dev`만 허용
- `preview_urls=true`
- `workers_dev=false`
- `DATABASE_URL`은 Cloudflare encrypted secret

### production

- `APP_ENV=production`
- `DEV_AUTH_BYPASS=false`
- `CORS_ALLOWED_ORIGINS` 기본 공백
- `preview_urls=false`
- `workers_dev=false`
- Track B에서는 deploy하지 않음

## Frontend preview build

Workflow build profile:

```text
VITE_DATA_MODE=api
VITE_AUTH_MODE=dev
VITE_STORAGE_MODE=mock
VITE_API_BASE_URL=<Worker preview URL>
VITE_COMPLEX_SLUG=bangnim-myeongji-roadhill
```

`VITE_AUTH_MODE=dev`는 Track A의 Neon Auth adapter가 아직 연결 전이기 때문에 유지한다. 단, Vite production build에서는 `x-danjion-dev-auth-user` header가 `import.meta.env.DEV` guard 때문에 전송되지 않는다. 따라서 preview에서 개발 auth bypass를 열지 않는다.

Storage는 Track C 범위이며 R2를 사용하지 않는다.

## Preview workflow

File:

`/.github/workflows/cloudflare-preview.yml`

Trigger:

- Draft PR #18의 `opened`, `synchronize`, `reopened` 중 backend/frontend/workflow 변경이 포함된 경우
- 수동 `workflow_dispatch`

Hard guards:

- head branch가 `feat/cloudflare-preview`인지 검사
- Worker env가 `preview`인지 검사
- Pages branch가 `main`이 아닌지 검사
- required secret이 없으면 deploy 전 실패

Sequence:

1. backend install/check
2. frontend install/typecheck
3. Worker preview version upload
4. Worker preview URL 추출
5. frontend를 해당 Worker URL로 production build
6. bundle에 Worker URL 주입 확인
7. Pages project 존재 확인, 없으면 빈 project 생성
8. `track-b` Pages preview deploy
9. `/api/health` + Neon DB `select 1` smoke
10. frontend URL smoke
11. 실제 frontend Origin으로 Worker GET CORS 확인
12. OPTIONS preflight CORS 확인
13. GitHub job summary에 preview evidence 기록

## Health contract

Worker `/api/health` 성공 조건:

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

- migration `001`~`008`: 변경하지 않음
- production seed: 실행하지 않음
- destructive DB write: 실행하지 않음
- Neon Auth internals: 변경하지 않음
- Google Drive storage: 변경하지 않음
- R2: 사용하지 않음
- production Worker deploy: NONE
- production Pages deploy: NONE
- PR merge: NONE

## Execution evidence

2026-08-08 Cloudflare Preview run #2에서 preview-only branch guard는 PASS했다.

그 다음 secret gate에서 다음 GitHub Actions secret이 모두 비어 있어 배포 전에 중단되었다.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `DATABASE_URL` (workflow 내부 변수명 `DANJION_DATABASE_URL`)

따라서 해당 run에서는 다음 단계가 모두 실행되지 않았다.

- Worker version upload
- Pages preview deploy
- `/api/health` smoke
- frontend/CORS smoke

현재 증거 기준 상태:

- Cloudflare preview resource creation/deployment: BLOCKED BEFORE DEPLOY
- production Worker deploy: NONE
- production Pages deploy: NONE
- PR merge: NONE

위 3개 secret을 repository Actions secrets에 설정한 뒤 같은 Draft PR에서 `Cloudflare Preview` workflow를 다시 실행하면 실제 preview URL과 smoke 결과를 확정할 수 있다.
