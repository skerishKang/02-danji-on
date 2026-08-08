# Track A — Neon Auth 실연결 작업지시서

GitHub Issue: #13
Branch: `feat/live-neon-auth`
Base: `feat/neon-live-foundation-20260808@64a204b567281447de681c52c7c58ac5a6e175f8`

## 임무

현재 DanjiOn backend의 `DEV_AUTH_BYPASS` / `AUTH_ADAPTER_PENDING` 경계를 실제 Neon Auth 인증으로 연결한다.

## 반드시 먼저 읽을 것

- `04_개발/docs/NEON_PRODUCTION_MIGRATION_20260808.md`
- `04_개발/docs/RESIDENT_VERIFICATION_v1.md`
- `04_개발/backend/docs/API_CONTRACT_v1.md`
- `04_개발/backend/src/app.ts`
- `04_개발/backend/src/core-v1.ts`
- `04_개발/backend/src/admin-v1.ts`
- `04_개발/backend/src/resident-verification-v1.ts`
- `04_개발/backend/src/admin-verification-v1.ts`

## 고정 전제

- Neon Organization: Padiem
- Neon Project: Danjion
- PostgreSQL 18 / Singapore
- Neon Auth enabled
- production schema `001`~`008` applied
- `app_users.auth_user_id` is the product identity bridge
- Neon Auth organization != apartment complex

## 구현 범위

1. server-side Neon Auth token/session verification adapter
2. duplicated `actorFromRequest`를 공통 auth resolver로 통합
3. Neon Auth subject → `app_users.auth_user_id` resolve/bootstrap
4. private/admin endpoints에 공통 auth 적용
5. production에서 dev header bypass 불가 보장
6. auth error contract 정리
7. tests/docs/env examples

## 금지

- migration 001~008 도메인 구조 임의 변경
- Cloudflare 배포 구현
- Google Drive storage 구현
- R2 도입
- production seed/사용자 생성
- PR merge

## 완료 Gate

- valid auth → actor resolved
- no auth → 401
- invalid auth → controlled auth error
- manager/admin membership authorization unchanged
- production dev-bypass impossible
- backend typecheck/tests green
- no secrets committed

## 제출 형식

Draft PR을 유지하고 PR body에 다음을 기록한다.

- 실제 구현한 auth flow
- app_users bootstrap/link 정책
- 필요한 environment/secrets
- tests 결과
- 남은 blocker
- production change 여부
