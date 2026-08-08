# DanjiOn Live Integration / Release Gate v1

## 1. 목적

이 문서는 Track D (`feat/live-integration-gate`)의 실제 인프라 통합 검증 기준을 고정한다.

Track D는 새 제품 기능을 구현하는 트랙이 아니다. 다음 sibling output을 **소비**하여 DanjiOn이 release 가능한지 판정하는 트랙이다.

- Track A: Neon Auth
- Track B: Cloudflare preview
- Track C: Google Drive storage

준비되지 않은 sibling dependency는 mock으로 대체해 PASS 처리하지 않고 `BLOCKED`로 기록한다.

기준선:

- Base branch: `feat/neon-live-foundation-20260808`
- Base SHA: `64a204b567281447de681c52c7c58ac5a6e175f8`
- Track D branch: `feat/live-integration-gate`
- Issue: #16
- Draft PR: #20

## 2. 절대 안전 규칙

1. production DB에 Track D test seed를 만들지 않는다.
2. mutating API E2E는 preview Worker가 **disposable Neon child branch**를 향한다는 운영 확인 없이는 실행하지 않는다.
3. `run-live-db-integration.sh`는 `DANJION_DB_TARGET=child`가 아니면 실행을 거부한다.
4. `LIVE_DATABASE_URL`이 `PRODUCTION_DATABASE_URL`과 동일하면 DB harness는 실행을 거부한다.
5. `live-vertical-flow.mjs`는 `DANJION_API_DB_TARGET=child`가 아니면 실행을 거부한다.
6. 실제 주민 개인정보를 test fixture로 사용하지 않는다. 인증 테스트 계정과 단지/동/호수는 synthetic 전용값을 사용한다.
7. production Cloudflare deploy는 Track D 범위 밖이다.
8. Track D에서 Auth, Cloudflare deployment, Google Drive adapter를 재구현하지 않는다.
9. migration `001`~`008`은 수정하지 않는다.
10. PR #20은 Draft를 유지하고 merge하지 않는다.

## 3. Gate 구성

### 3.1 Neon child DB integration

파일:

- `04_개발/backend/tests/run-live-db-integration.sh`
- `04_개발/backend/tests/live-db-integration.sql`

검증:

- schema `001`~`008` 핵심 table 존재
- application review trigger 존재
- resident verification review trigger 존재
- business application `pending → changes_requested → pending → approved`
- application immutable review events 누적
- resident verification `pending → rejected → pending → verified`
- resident verification immutable review events 누적
- membership / verification record 최종 상태 동기화
- benefit wallet `stored → used`
- synthetic rows cleanup

SQL 검증은 하나의 PostgreSQL `DO` statement에서 수행한다. 중간 assertion이 실패하면 statement 전체가 rollback된다. 성공 시에도 synthetic row를 명시적으로 제거하고 잔존 여부를 다시 검사한다.

실행 예:

```bash
DANJION_DB_TARGET=child \
LIVE_DATABASE_URL='postgresql://...disposable-child...' \
PRODUCTION_DATABASE_URL='postgresql://...production...' \
bash 04_개발/backend/tests/run-live-db-integration.sh
```

`PRODUCTION_DATABASE_URL`은 안전 비교를 위한 optional 값이지만 release 운영에서는 설정을 권장한다.

### 3.2 Preview API smoke / auth negative

파일:

- `04_개발/backend/tests/live-preview-smoke.mjs`

항목:

- `GET /api/health` → 200, DB health `ok`
- 무인증 private endpoint → 401 `AUTH_REQUIRED`
- 무인증 admin endpoint → 401 `AUTH_REQUIRED`
- invalid bearer → Track A 완료 후 controlled 401
- valid resident bearer → `/api/v1/me` 200
- valid manager/admin bearer → admin list 200
- synthetic complex public read → 200

현재 backend 기준에서 bearer가 들어오면 `AUTH_ADAPTER_PENDING` 501을 반환하므로, Track A가 아직 통합되지 않은 상태에서는 이 항목을 **BLOCKED_TRACK_A**로 기록한다. `DANJION_GATE_MODE=release`에서는 BLOCKED가 최종 PASS로 처리되지 않는다.

### 3.3 Resident/Admin live vertical flow

파일:

- `04_개발/backend/tests/live-vertical-flow.mjs`

필수 전제:

- preview Worker가 disposable Neon child DB를 사용
- Track A 실제 token 검증이 통합됨
- synthetic resident token
- synthetic verification-resident token
- synthetic verified manager/admin token
- synthetic complex와 각 membership이 child DB에 준비됨

자동 흐름:

1. 일반 resident가 admin API 접근 시 403
2. resident business application 생성
3. admin changes request
4. resident status 확인
5. resident 보완·재제출
6. admin 승인
7. resident 승인 상태 확인
8. public business 검색에서 승인된 사업 확인
9. 생성된 주민혜택 claim
10. benefit `stored → used`
11. 별도 미인증 synthetic resident의 입주민 인증 신청
12. admin 반려
13. resident 동·호수 수정 후 재신청
14. admin 승인
15. resident 최종 `verified` 상태 확인

이 flow는 실제 mutation을 발생시키므로 production에서는 절대 실행하지 않는다. 실행이 끝난 뒤 disposable Neon child branch 자체를 삭제/재생성하는 방식을 기본 cleanup으로 한다.

대표 이미지/주민 증빙의 **실제 Google Drive file flow는 이 script에 포함하지 않는다.** `representativeImageObjectKey`를 `null`로 두며 Track C가 통합되기 전 파일 flow를 가짜 PASS로 만들지 않는다.

### 3.4 Frontend preview release viewport

파일:

- `04_개발/frontend/playwright.live.config.ts`
- `04_개발/frontend/e2e/live-release.spec.ts`

대상 viewport:

- desktop: 1440 × 1000
- mobile: 390 × 844
- mobile: 320 × 720

대상 surface:

- `/`
- `/admin.html`
- `/verification.html`
- `/verification-admin.html`

검증:

- navigation response 존재
- 5xx 없음
- body render
- horizontal overflow 없음
- 주민 홈 검색 UI 표시
- 모바일 하단 navigation 표시
- 모바일 `주민혜택 → 홈` 핵심 navigation 동작

실행:

```bash
cd 04_개발/frontend
DANJION_FRONTEND_PREVIEW_URL='https://...preview...' \
npx playwright test --config=playwright.live.config.ts
```

Track B frontend preview URL이 없으면 config가 즉시 `BLOCKED_TRACK_B` 오류를 내고 종료한다.

## 4. Release Gate CI

Workflow:

- `.github/workflows/live-release-gate.yml`

항상 실행 가능한 static gate:

- backend live `.mjs` syntax parse
- child DB wrapper shell syntax parse
- live Playwright config/test discovery parse

live jobs는 기본 비활성이다. branch 단계에서 merge 없이 실행할 수 있도록 `feat/live-integration-gate` push에서 다음 repository variable을 명시적으로 `true`로 설정한 경우에만 실행한다.

| Job | Enable variable | 필수 설정 |
|---|---|---|
| Neon child DB integration | `DANJION_TRACK_D_RUN_LIVE_DB=true` | `DANJION_DB_TARGET=child`, secret `DANJION_LIVE_DB_URL`, optional safety secret `DANJION_PRODUCTION_DB_URL` |
| Preview API smoke | `DANJION_TRACK_D_RUN_PREVIEW_SMOKE=true` | `DANJION_PREVIEW_API_URL`, test complex slug, Track A tokens |
| Live vertical flow | `DANJION_TRACK_D_RUN_VERTICAL_FLOW=true` | `DANJION_API_DB_TARGET=child`, preview URL, complex slug, resident/verification-resident/admin tokens |
| Frontend viewports | `DANJION_TRACK_D_RUN_FRONTEND_VIEWPORTS=true` | `DANJION_FRONTEND_PREVIEW_URL` |

`workflow_dispatch` 입력도 정의되어 있으나, Draft branch에서 workflow가 default branch에 아직 존재하지 않는 동안에는 branch `push` + explicit variable 방식이 merge 없는 실행 경로다.

preview smoke의 최종 release 판정에서는 `DANJION_GATE_MODE=release`를 사용한다. branch push 방식에서는 repository variable `DANJION_GATE_MODE=release`를 설정한다.

## 5. Sibling dependency 상태 — 2026-08-08 Track D 작성 시점

| Dependency | 관측 상태 | Track D 판정 |
|---|---|---|
| Track A / PR #17 | Draft이며 Track D 작성 시점 head에서 실제 Auth output을 아직 소비할 수 없음 | **BLOCKED_A** |
| Track B / PR #18 | sibling branch에서 preview workflow/config 구현이 진행 중이지만 Track D branch에 통합되지 않았고 usable preview URL evidence를 아직 받지 못함 | **BLOCKED_B** |
| Track C / PR #19 | sibling branch에서 Drive adapter 구현이 진행 중이지만 Track D branch에 통합되지 않았고 real Drive file-flow evidence를 아직 받지 못함 | **BLOCKED_C** |

Sibling branch에 코드가 존재하는 것과 Track D의 최종 live gate가 PASS한 것은 동일하지 않다. 최종 gate는 A/B/C output을 integration branch에 실제로 결합한 뒤 다시 실행해야 한다.

## 6. 현재 PASS / BLOCKED matrix

### PASS — 구현·정적 gate 준비

- child-only DB integration harness 작성
- production URL 동일성 방어 추가
- application / verification / benefit DB state-transition assertion 작성
- 성공 cleanup + 실패 rollback 구조 작성
- preview public/private/admin smoke script 작성
- auth/authorization negative assertions 작성
- resident/admin full vertical API flow script 작성
- 1440 / 390 / 320 preview browser gate 작성
- release gate CI workflow 작성
- rollback checklist 작성

### BLOCKED — 실제 runtime evidence

- **BLOCKED_DB_RUNTIME**: Track D에 disposable Neon child `LIVE_DATABASE_URL`이 제공되지 않아 새 DB harness를 실제 실행하지 않음
- **BLOCKED_A**: 실제 Neon Auth adapter/token output 미통합
- **BLOCKED_B**: Track D에서 사용할 확정 Worker/frontend preview URL 미수신
- **BLOCKED_C**: 실제 Google Drive public business image / private resident evidence flow 미통합
- **BLOCKED_FINAL_VERTICAL**: A + B + synthetic child fixture가 모두 필요
- **BLOCKED_FINAL_FILE_FLOW**: A + B + C가 모두 필요

BLOCKED는 실패를 숨기기 위한 표현이 아니다. 해당 dependency가 들어오기 전에는 release 판정을 `READY`로 올리지 않는다는 의미다.

## 7. Production write status

Track D 작성/구현 단계에서 production write:

**NONE**

- production DB seed: NONE
- production DB test mutation: NONE
- production Cloudflare deploy: NONE
- production Drive write: NONE
- PR merge: NONE

기존 migration 기록상 production에는 `001`~`008`만 적용되어 있고 dev seed `900+`는 적용되지 않은 상태를 기준으로 한다.

## 8. 최종 READY 조건

다음 항목이 모두 PASS여야 `READY`다.

1. Track D head가 승인된 A/B/C output을 실제 포함한다.
2. existing Backend / Frontend / Resident Verification / Pre-Infra CI가 green이다.
3. child DB integration harness PASS.
4. preview `/api/health` + DB health PASS.
5. no-auth 401 / invalid-auth controlled 401 PASS.
6. valid resident auth 200 PASS.
7. resident token의 admin 접근 403 PASS.
8. verified manager/admin access PASS.
9. business application → changes request → resubmit → approval → resident/public confirmation PASS.
10. resident verification reject → reapply → approve PASS.
11. benefit claim → stored → used PASS.
12. Track C real public business image flow PASS.
13. Track C private resident evidence가 public URL로 노출되지 않음을 PASS.
14. 1440 / 390 / 320 frontend preview navigation + no-overflow PASS.
15. disposable child test data cleanup 완료.
16. production application tables에 Track D synthetic/test row 0건 확인.
17. production deploy는 별도 승인 전까지 NONE.

하나라도 BLOCKED 또는 FAIL이면 판정은 `NOT_READY`다.

## 9. Rollback checklist

### Preview/API failure

1. production deploy를 실행하지 않는다.
2. 문제가 있는 preview version/Pages branch만 폐기한다.
3. sibling Track 변경을 Track D에서 임의 수정하지 않고 해당 Track에 blocker를 반환한다.
4. 마지막 known-green base `feat/neon-live-foundation-20260808@64a204b...`를 비교 기준으로 유지한다.

### Neon child DB test failure

1. production DB에 repair SQL을 실행하지 않는다.
2. 실패한 disposable child branch를 폐기한다.
3. 새 production child에서 migration `001`~`008`을 다시 검증한 뒤 harness를 재실행한다.
4. production migration 전 snapshot `pre-danjion-schema-20260808`은 보존한다.

### Auth failure

1. dev header bypass를 production fallback으로 켜지 않는다.
2. Track A output을 되돌리거나 수정해야 하면 Track A branch/PR에서 처리한다.
3. invalid/expired token을 PASS로 완화하지 않는다.

### Storage failure

1. private resident evidence를 public Drive permission으로 바꾸지 않는다.
2. mock storage를 production substitute로 승격하지 않는다.
3. Track C에서 생성한 synthetic test artifact만 정리한다.
4. real resident evidence를 release test에 사용하지 않는다.

### Release 취소

1. PR #20 Draft 유지.
2. merge하지 않는다.
3. production deploy하지 않는다.
4. 모든 `DANJION_TRACK_D_RUN_*` variable을 `false`로 되돌린다.
5. 임시 bearer token/credential을 폐기 또는 rotate한다.
6. disposable Neon child branch를 삭제한다.
7. production test-row 0건을 재확인한다.

## 10. Artifacts / logs

- GitHub Actions job log: `Live Release Gate`
- Playwright HTML: `04_개발/frontend/playwright-report`
- Playwright raw results: `04_개발/frontend/test-results`
- uploaded artifact: `track-d-live-playwright-diagnostics`
- DB harness: stdout/stderr의 `PASS Track D live DB integration` 또는 명시적 `BLOCKED/REFUSED`
- Preview smoke: stdout의 `PASS`, `BLOCKED_TRACK_A`, `BLOCKED_TRACK_B`
- Vertical flow: stdout의 synthetic application/business/verification IDs

## 11. 현재 Release verdict

**NOT_READY**

이유: Track D gate 구조는 준비되었지만 A/B/C를 실제 통합한 runtime evidence가 아직 없으며, 특히 Auth·preview URL·Drive real file flow가 최종 gate의 필수 의존성이다.
