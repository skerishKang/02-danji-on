# Track D — Live Integration / Release Gate 작업지시서

GitHub Issue: #16
Branch: `feat/live-integration-gate`
Base: `feat/neon-live-foundation-20260808@64a204b567281447de681c52c7c58ac5a6e175f8`

## 임무

Track A/B/C의 결과를 받아 실제 인프라에서 DanjiOn의 release readiness를 자동검증한다. 이 트랙은 새 기능 개발보다 integration/E2E/release gate에 집중한다.

## 반드시 먼저 읽을 것

- `04_개발/docs/NEON_PRODUCTION_MIGRATION_20260808.md`
- `04_개발/docs/PREINFRA_INTEGRATION_v1.md`
- `04_개발/docs/FIELD_DEMO_PARITY_v1.md`
- `04_개발/frontend/playwright.config.ts`
- `04_개발/frontend/e2e/*`
- backend contract/integration tests

## 고정 전제

- Neon production schema 001~008 적용 완료
- production seed 0건
- migration 전 snapshot branch 보존 중
- mock/dev E2E green
- Auth/Cloudflare/Drive 실제 연결은 Track A/B/C 담당

## 구현 범위

1. Neon child branch 기반 live DB integration harness
2. preview API smoke tests
3. resident → business application → admin review → resident status
4. resident verification 신청/승인/반려/재신청
5. benefit wallet claim/use
6. auth/authorization negative tests
7. 320/390/desktop release viewport checks
8. release PASS/FAIL checklist
9. rollback checklist
10. release gate CI

## 의존성

- Track A 결과 없이는 최종 auth E2E BLOCKED 가능
- Track B preview URL 없이는 final deployment E2E BLOCKED 가능
- Track C 결과 없이는 real file flow BLOCKED 가능

BLOCKED 항목을 mock으로 속여 통과시키지 말고 명시적으로 남긴다.

## 금지

- Auth 핵심 구현 변경
- Cloudflare 배포 구현 변경
- Drive adapter 구현 변경
- 테스트 통과를 위한 제품기능 삭제/완화
- migration 001~008 임의 변경
- production test seed
- production deploy
- PR merge

## 완료 Gate

- non-destructive live DB test 재현 가능
- public/private/admin smoke coverage
- 핵심 resident/admin vertical flow 자동검증
- negative auth/authorization 검증
- viewport release checks
- 테스트 데이터 production 잔존 없음
- release/rollback checklist complete

## 제출 형식

Draft PR을 유지하고 PR body에 다음을 기록한다.

- PASS 항목
- BLOCKED 항목과 의존 Track
- 실행한 live/non-live 환경
- production write 여부
- artifacts/logs 위치
- 최종 release 판정: READY / NOT_READY
