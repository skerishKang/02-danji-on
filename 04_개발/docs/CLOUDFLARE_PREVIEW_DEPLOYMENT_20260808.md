# DanjiOn Cloudflare Preview Deployment — 2026-08-08

## Scope

Track B (`feat/cloudflare-preview`, Issue #14, Draft PR #18) 전용 Cloudflare preview 배포 기준과 실제 실행 증거를 기록한다.

이 문서는 preview 배포만 다룬다. production deploy와 PR merge는 이 트랙에서 수행하지 않는다.

## Cloudflare resources

### Worker preview

- Wrangler environment: `preview`
- Worker resource name: `padiem-danjion-api-preview`
- Stable preview alias: `track-b`
- Stable preview URL: `https://track-b-padiem-danjion-api-preview.padiem.workers.dev`
- Stable `workers.dev` traffic route: disabled
- Version/alias preview URLs: enabled
- Normal publish method: `wrangler versions upload --env preview --preview-alias track-b`
- Active production traffic deployment: 없음

Cloudflare는 존재하지 않는 Worker에 대해 `wrangler versions upload`를 허용하지 않는다. 따라서 최초 1회에 한해 dedicated preview resource인 `padiem-danjion-api-preview`를 `wrangler deploy --env preview`로 bootstrap한다. 이 bootstrap은 `workers_dev=false`, 별도 routes/custom domains 없음 상태에서 수행되며 실제 실행 로그에서도 `No targets deployed for padiem-danjion-api-preview`로 확인됐다.

Worker가 생성된 뒤에는 다시 `wrangler versions upload --env preview --preview-alias track-b` 경로만 사용한다. 이 명령은 새 Worker version과 version preview URL을 생성하지만 그 version을 production traffic에 활성화하지 않는다.

Workflow는 Cloudflare Worker subdomain API로 다음 상태를 강제 검증한다.

```json
{
  "enabled": false,
  "previews_enabled": true
}
```

즉 stable `workers.dev` route는 열지 않고 version/alias preview URL만 활성화한다.

### Frontend preview

- Cloudflare Pages project: `padiem-danjion-web-preview`
- Pages production branch metadata: `main`
- Preview deployment branch: `track-b`
- Stable branch preview alias: `https://track-b.padiem-danjion-web-preview.pages.dev`
- Production Pages deployment: 없음

Workflow는 반드시 `--branch=track-b`로만 Pages deploy를 실행한다.

Pages project 존재 여부는 Cloudflare의 exact project endpoint `GET /accounts/{account_id}/pages/projects/{project_name}`로 확인한다. 200이면 기존 project를 재사용하고, 404일 때만 최초 생성한다. 이 방식으로 반복 실행 시 project 중복 생성 오류가 발생하지 않도록 했다.

## Required GitHub Actions secrets

Repository Actions secrets에 다음 3개가 설정되어 있다.

- `CLOUDFLARE_API_TOKEN`
  - Padiem Cloudflare Account의 Worker/Pages preview 리소스를 만들고 version/direct-upload를 수행할 제한 권한 token
- `CLOUDFLARE_ACCOUNT_ID`
  - Padiem Cloudflare Account ID
- `DATABASE_URL`
  - Padiem Neon `Danjion` connection string

Secret 값은 repository 파일, PR body, workflow log에 기록하지 않는다.

Workflow는 `${RUNNER_TEMP}`에 일회성 secret file을 만들고 Worker upload/deploy 명령의 `--secrets-file`로 `DATABASE_URL`을 암호화된 Worker secret으로 업로드한다. runner 종료 후 파일은 폐기된다.

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
VITE_API_BASE_URL=https://track-b-padiem-danjion-api-preview.padiem.workers.dev
VITE_COMPLEX_SLUG=bangnim-myeongji-roadhill
```

`VITE_AUTH_MODE=dev`는 Track A의 Neon Auth adapter가 아직 sibling track에서 통합 전이기 때문에 유지한다. 단, Vite production build에서는 `x-danjion-dev-auth-user` header가 `import.meta.env.DEV` guard 때문에 전송되지 않는다. 따라서 preview에서 개발 auth bypass를 열지 않는다.

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
- Worker name이 `padiem-danjion-api-preview`인지 검사
- production Worker name과 일치하지 않는지 검사
- Pages branch가 `main`이 아닌지 검사
- required secret이 없으면 Cloudflare 작업 전 실패
- stable Worker `workers.dev` route를 disabled로 유지
- Worker version/alias preview URL만 enabled로 유지

Sequence:

1. backend install/check
2. frontend install/typecheck
3. Worker 존재 시 preview version upload
4. Worker 미존재 시 dedicated preview Worker 1회 bootstrap 후 preview version upload
5. Worker preview routing state 강제 (`enabled=false`, `previews_enabled=true`)
6. Worker preview URL 추출
7. frontend를 해당 Worker URL로 production build
8. bundle에 Worker URL 주입 확인
9. Pages project exact lookup, 404일 때만 생성
10. `track-b` Pages preview deploy
11. `/api/health` + Neon DB `select 1` smoke
12. frontend URL smoke
13. 실제 frontend Origin으로 Worker GET CORS 확인
14. OPTIONS preflight CORS 확인
15. GitHub job summary에 preview evidence 기록

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
- production Worker traffic deployment: NONE
- production Pages deployment: NONE
- PR merge: NONE

## Execution evidence

### Initial credential gate

초기 Cloudflare Preview run에서는 다음 GitHub Actions secret이 없어 Cloudflare 작업 전 중단됐다.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `DATABASE_URL`

세 secret을 repository Actions secrets에 설정한 뒤 credential gate는 PASS했다. 값 자체는 workflow log와 repository에 노출하지 않았다.

### First-time Worker bootstrap discovery

secret 설정 후 최초 실제 upload 시 Cloudflare가 존재하지 않는 Worker에 `versions upload`를 허용하지 않아 다음 오류를 반환했다.

```text
You cannot upload a new version of a Worker that does not yet exist.
```

이에 preview resource 이름과 environment를 고정 검증한 뒤 1회 bootstrap 경로를 추가했다. 실제 bootstrap 로그는 Worker를 생성했지만 `No targets deployed`를 기록했으며 production traffic target은 생성되지 않았다.

### Preview URL routing correction

최초 bootstrap 후 version preview alias가 생성됐지만 `/api/health`가 404를 반환했다. Worker subdomain API를 사용해 stable `workers.dev` route는 disabled, version/alias preview URLs는 enabled 상태를 명시적으로 강제하도록 수정했다.

### Pages project idempotency correction

Pages project 최초 생성/배포는 성공했으나 다음 실행에서 list JSON 해석이 기존 project를 탐지하지 못해 중복 create를 시도했다. exact project GET endpoint 기반으로 변경해 200은 재사용, 404만 create하도록 수정했다.

### Final successful run

Cloudflare Preview run #21 (`31253570950`)에서 다음 전체 sequence가 PASS했다.

- preview-only branch/resource guards: PASS
- required secret gate: PASS
- backend check: PASS (52 contract checks)
- frontend typecheck: PASS
- Worker preview version upload: PASS
- Worker stable route disabled / preview URLs enabled: PASS
- frontend production build: PASS
- Worker URL bundle wiring: PASS
- exact Pages project lookup: PASS
- `track-b` Pages preview deployment: PASS
- Worker `/api/health`: PASS
- Neon DB connectivity (`database=ok`): PASS
- frontend HTTP smoke: PASS
- GET CORS from actual Pages preview origin: PASS
- OPTIONS preflight CORS: PASS

Final preview endpoints:

```text
Worker alias
https://track-b-padiem-danjion-api-preview.padiem.workers.dev

Pages alias
https://track-b.padiem-danjion-web-preview.pages.dev
```

Final successful Worker version in run #21:

```text
e388df78-085e-4e19-9309-0a909c155fe7
```

Final successful Pages deployment URL in run #21:

```text
https://d2dba7f0.padiem-danjion-web-preview.pages.dev
```

Health response evidence:

```json
{
  "data": {
    "status": "ok",
    "database": "ok"
  }
}
```

현재 증거 기준 상태:

- Cloudflare Worker preview: LIVE / PASS
- Cloudflare Pages branch preview: LIVE / PASS
- Neon DB health connectivity: PASS
- frontend/CORS smoke: PASS
- production Worker traffic deploy: NONE
- production Pages deploy: NONE
- R2 usage: NONE
- PR merge: NONE
