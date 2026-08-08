# Track B — Cloudflare Preview 배포 작업지시서

GitHub Issue: #14
Branch: `feat/cloudflare-preview`
Base: `feat/neon-live-foundation-20260808@64a204b567281447de681c52c7c58ac5a6e175f8`

## 임무

Padiem Cloudflare Account에 DanjiOn frontend + Worker preview 환경을 만든다. 이 트랙은 배포/환경/네트워크만 담당한다.

## 반드시 먼저 읽을 것

- `04_개발/docs/NEON_PRODUCTION_MIGRATION_20260808.md`
- `04_개발/docs/PREINFRA_INTEGRATION_v1.md`
- `04_개발/backend/wrangler.jsonc`
- `04_개발/backend/.dev.vars.example`
- `04_개발/frontend/.env.example`
- `.github/workflows/*`

## 고정 전제

- Cloudflare Account: Padiem
- Neon Project: Danjion
- production DB schema applied
- R2는 사용하지 않는다
- secrets는 GitHub에 commit하지 않는다

## 구현 범위

1. Worker preview deployment
2. frontend preview deployment
3. preview/prod environment separation
4. `DATABASE_URL` 등 secrets binding 문서/설정
5. frontend API base URL wiring
6. CORS/health/smoke checks
7. 필요한 preview CI/workflow

## 금지

- Neon Auth 핵심 구현: Track A 담당
- Google Drive storage: Track C 담당
- migration 001~008 변경
- 앱 기능 삭제/mock 회귀
- R2 도입
- production deploy
- PR merge

## 완료 Gate

- Worker preview URL 존재
- frontend preview URL 존재
- `/api/health` 정상
- frontend → preview Worker 연결
- secrets repository 노출 없음
- preview/prod config 분리
- existing CI green

## 제출 형식

Draft PR을 유지하고 PR body에 다음을 기록한다.

- Cloudflare resource names
- preview URLs
- 수동으로 설정한/설정해야 할 secrets
- smoke test 결과
- production deploy 여부: 반드시 NONE
- 남은 blocker
