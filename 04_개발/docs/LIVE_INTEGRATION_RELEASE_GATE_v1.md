# DanjiOn Live Integration / Release Gate v1

## 1. 목적

이 문서는 고정 Track D output `93da53cc0b15044318154a589ddba9ff286e8ec7`을 Track E `feat/live-stack-integration`에 통합한 이후의 live release gate 기준을 기록한다.

Track E에 통합된 고정 sibling input:

- Track A / PR #17: `011950fe20b16e38869092eaaa4b945ae69e7be2`
- Track B / PR #18: `94633a11a4633d386e87591141072f7d03f7e918`
- Track C / PR #19: `3a653310317bbfd6543163a992ed46e1c58eafc8`
- Track D / PR #20: `93da53cc0b15044318154a589ddba9ff286e8ec7`

준비되지 않은 external runtime dependency는 mock으로 대체해 PASS 처리하지 않고 `BLOCKED`로 기록한다.

## 2. 절대 안전 규칙

1. production DB에 integration/live test seed를 만들지 않는다.
2. mutating API E2E는 preview Worker가 Neon child branch를 향한다는 확인 없이는 실행하지 않는다.
3. `run-live-db-integration.sh`는 `DANJION_DB_TARGET=child`가 아니면 실행을 거부한다.
4. `LIVE_DATABASE_URL`이 `PRODUCTION_DATABASE_URL`과 동일하면 DB harness는 실행을 거부한다.
5. `live-vertical-flow.mjs`는 `DANJION_API_DB_TARGET=child`가 아니면 실행을 거부한다.
6. 실제 주민 개인정보를 test fixture로 사용하지 않는다.
7. production Cloudflare deploy를 수행하지 않는다.
8. migration `001`~`008`은 수정하지 않는다.
9. production Google Drive에 test write를 수행하지 않는다.
10. Draft PR #22를 merge하거나 Ready for Review로 전환하지 않는다.

## 3. Preview DB contract

Track E live/preview target은 production이 아니라 다음 Neon child branch다.

- project: Padiem / Danjion
- branch: `cloudflare-preview-20260808`
- branch id: `br-hidden-frog-azdevrqe`
- production parent: `br-bold-sun-azurylwi`
- creation-time schema diff vs production: empty
- creation-time application rows: 0

실제 connection string은 secret이며 repository, PR, issue, log에 기록하지 않는다.

## 4. Gate 구성

### 4.1 Neon child DB integration

파일:

- `04_개발/backend/tests/run-live-db-integration.sh`
- `04_개발/backend/tests/live-db-integration.sql`

검증:

- schema `001`~`008` 핵심 table/trigger 존재
- business application `pending → changes_requested → pending → approved`
- application review events 누적
- resident verification `pending → rejected → pending → verified`
- resident verification review events 누적
- membership/verification 상태 동기화
- benefit wallet `stored → used`
- synthetic row cleanup

실패 시 PostgreSQL statement rollback, 성공 시 synthetic row 명시 cleanup을 수행한다.

### 4.2 Preview API smoke / auth negative

파일: `04_개발/backend/tests/live-preview-smoke.mjs`

검증:

- `/api/health` 200 + DB health ok
- no-auth private/admin 401 `AUTH_REQUIRED`
- invalid bearer controlled 401
- valid resident `/api/v1/me` 200
- valid manager/admin admin list 200
- synthetic complex public read 200

Track E 코드에는 Track A canonical Neon Auth가 통합되어 있으므로 `AUTH_ADAPTER_PENDING`은 정상 최종 상태가 아니다. runtime Neon Auth URL/JWKS/token이 없으면 live smoke는 BLOCKED로 남긴다.

### 4.3 Resident/Admin live vertical flow

파일: `04_개발/backend/tests/live-vertical-flow.mjs`

- resident admin 접근 403
- business application 생성 → changes request → 보완 → 승인
- approved business public search
- benefit claim → stored → used
- resident verification 신청 → 반려 → 재신청 → 승인

이 flow는 mutation을 발생시키므로 반드시 child DB에만 실행한다.

### 4.4 Google Drive storage

Track C adapter는 integration branch에 존재하며 storage private routes는 Track A의 canonical `auth-v1.ts requireActor()`를 사용한다.

보안 경계:

- public business image: backend proxy를 통한 anonymous read만 허용
- private resident evidence: uploader 또는 같은 complex의 verified manager/admin
- Drive public permission / `webViewLink` / `webContentLink` 사용 금지
- real Drive test는 production Drive가 아닌 별도 승인된 non-production/synthetic target이 준비될 때만 수행

Track D의 기존 vertical script는 `representativeImageObjectKey=null`이므로 real Drive file flow를 가짜 PASS로 간주하지 않는다.

### 4.5 Frontend viewport gate

파일:

- `04_개발/frontend/playwright.live.config.ts`
- `04_개발/frontend/e2e/live-release.spec.ts`

viewport:

- 1440 × 1000
- 390 × 844
- 320 × 720

surface:

- `/`
- `/admin.html`
- `/verification.html`
- `/verification-admin.html`

5xx, horizontal overflow, 핵심 모바일 navigation을 검사한다.

## 5. Track E integration assertions

코드 통합 PASS에는 다음이 포함되어야 한다.

1. `storage-v1.ts`에 `AUTH_ADAPTER_PENDING`과 자체 `actorFromRequest`가 없어야 한다.
2. storage private mutation/read가 Track A `auth-v1.ts`의 canonical `requireActor()`를 사용해야 한다.
3. `app.ts`에 Track C `handleStorageRequest` routing과 Track B CORS allowlist/response wrapping이 동시에 존재해야 한다.
4. backend `.dev.vars.example`에 DB/app, CORS, Neon Auth, Drive placeholder가 모두 존재해야 한다.
5. backend `package.json`이 auth + storage + contract tests를 모두 실행해야 한다.
6. frontend `.env.example`이 API preview + `mock|drive` storage contract를 보존해야 한다.
7. secrets는 commit하지 않는다.

`backend/tests/storage-contract.mjs`가 storage auth integration assertion을 직접 수행한다.

## 6. Release Gate CI

Workflow: `.github/workflows/live-release-gate.yml`

항상 실행 가능한 static gate:

- backend live `.mjs` syntax parse
- child DB shell wrapper syntax parse
- live Playwright config/test discovery parse
- storage canonical auth integration assertion

실제 live job은 명시적인 repository variable/input과 secret이 있을 때만 실행한다. 기본 상태에서는 skip/BLOCKED가 정상이다.

Track E에서 child DB secret은 `DANJION_PREVIEW_DATABASE_URL`을 사용하며, production DB와 이름부터 분리한다.

## 7. External live dependencies

코드 통합이 green이어도 다음 실제 runtime 값이 없으면 final release READY는 아직 판정하지 않는다.

- Cloudflare preview account/token configuration
- Neon child `DANJION_PREVIEW_DATABASE_URL`
- Neon Auth runtime URL/JWKS + synthetic bearer tokens
- Google Drive OAuth/folder configuration for a non-production/synthetic smoke target
- preview Worker/frontend URLs

이 항목들은 code integration 실패가 아니라 live evidence dependency다.

## 8. Rollback checklist

### Preview/API failure

1. production deploy를 실행하지 않는다.
2. 문제가 있는 preview version/Pages branch만 폐기한다.
3. 고정 sibling head와 integration commit을 비교해 회귀 범위를 특정한다.

### Neon child DB failure

1. production DB에 repair/test SQL을 실행하지 않는다.
2. 실패한 child branch를 폐기/재생성한다.
3. migration `001`~`008` schema contract를 확인한 후 다시 실행한다.
4. `pre-danjion-schema-20260808` snapshot은 보존한다.

### Auth failure

1. production dev-header bypass를 켜지 않는다.
2. invalid/expired JWT를 PASS로 완화하지 않는다.
3. Track A canonical auth 경계를 우회하는 storage 전용 인증을 다시 만들지 않는다.

### Storage failure

1. private resident evidence를 public permission으로 전환하지 않는다.
2. mock storage를 production substitute로 승격하지 않는다.
3. real resident evidence를 release test에 사용하지 않는다.

### Integration 취소

1. PR #22 Draft 유지.
2. merge하지 않는다.
3. production deploy/write를 수행하지 않는다.
4. temporary credentials/tokens가 있었다면 폐기 또는 rotate한다.
5. synthetic child fixture/branch를 정리한다.

## 9. Production write status

Track E integration 작업에서 production write/deploy:

**NONE**

- production DB seed/mutation: NONE
- production Cloudflare Worker/Pages deploy: NONE
- production Google Drive write: NONE
- R2: NONE
- migration `001`~`008` change: NONE
- PR merge: NONE

## 10. 판정 구분

`INTEGRATION_GREEN`은 A/B/C/D 코드 조합과 요구된 non-production/static CI가 green이라는 뜻이다. 이는 production release `READY`와 동일하지 않다.

실제 live runtime gate가 외부 설정 부족으로 실행되지 않은 경우 이를 별도 `LIVE_BLOCKED_EXTERNAL`로 기록한다. 코드 통합 자체에 실패하거나 필수 CI가 red면 `INTEGRATION_BLOCKED`로 판정한다.
