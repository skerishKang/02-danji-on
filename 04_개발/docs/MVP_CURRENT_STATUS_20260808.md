# DanjiOn MVP Current Status — 2026-08-08

이 문서는 동생이 현재 GitHub를 보고 **무엇이 실제 구현됐고, 무엇이 mock/placeholder이며, 무엇이 외부 설정 때문에 아직 검증되지 않았는지** 빠르게 판단하기 위한 handoff snapshot이다.

## 1. 결론

DanjiOn은 더 이상 HTML prototype만 있는 단계가 아니다.

현재 저장소에는 다음이 모두 존재한다.

- React + TypeScript + Vite 제품 frontend
- Cloudflare Worker backend
- Neon PostgreSQL production schema
- Neon Auth backend JWT verification layer
- 주민 인증 신청/검토/승인 흐름
- 사업자 신청/보완/반려/승인 흐름
- 주민혜택 wallet
- 관리자 운영 화면
- Google Drive StorageAdapter와 backend proxy contract
- Cloudflare Preview deployment workflow
- live integration/release gate harness
- Playwright E2E와 contract tests

다만 **실제 브라우저 Neon Auth login/session**, **실 Google Drive OAuth 파일-flow**, **실 사용자 인증부터 사업 승인까지의 최종 deployed E2E**는 아직 끝나지 않았다.

## 2. 저장소/브랜치 상태

Repository: `skerishKang/02-danji-on`

현재 주요 기준:

- `main`: 전체 최신 개발을 포함하지 않음
- `feat/neon-live-foundation-20260808`: production DB migration 기반
- `feat/live-neon-auth`: Track A
- `feat/cloudflare-preview`: Track B
- `feat/google-drive-storage`: Track C
- `feat/live-integration-gate`: Track D
- `feat/live-stack-integration`: Track E 통합
- 모든 주요 PR은 현재 Draft / 미병합 상태

현재 handoff 시점에는 `main`을 제품 최신판으로 간주하지 않는다.

## 3. PR별 실제 역할

### PR #4 — Pre-Infra Integration

이미 구현된 핵심 사용자 흐름:

- 검색 → 상세 → 찜
- 인증 주민 연락처
- `내 일 알리기` 4단계 wizard
- 대표 이미지 mock upload
- 주민 공개정보 / 운영 비공개정보 분리
- 관리자 보완 요청 / 반려 / 승인
- 보완 후 재제출
- 승인 business 공개
- 단지소식 / 주민혜택
- application idempotency
- 주민 인증 신청 → 관리자 승인/반려
- desktop/mobile E2E

### PR #5~#10 — 현장시연 제품화

현장 MVP flow를 React 제품 코드와 E2E로 고정했다.

`발견 → 검색 → 상세 → 주민혜택 → 내정보 → 내 일 등록 → 홍보물 → 운영확인 → 승인 공개 → 다시 발견 → 생활경제 엔딩`

포함 내용:

- 실제 작업장면 기반 cinematic hero
- 주민혜택 stored → used lifecycle
- 홍보물 3종
- 운영확인 privacy-safe 화면
- 승인 후 public re-entry
- Scene 08 ending
- deterministic demo reset/recovery/offline shell

### PR #12 — Neon Live Foundation

실제 Padiem / Danjion Neon project에서 PostgreSQL 18 migration을 검증하고 production에 001~008을 적용했다.

실제 확인:

- DanjiOn public tables 생성
- Neon Auth schema 존재
- application review audit
- resident verification columns/status sync/audit
- benefit wallet persistence

Production 적용 후 개발용 seed는 넣지 않았다.

### PR #17 — Track A / Neon Auth

Backend auth core는 구현돼 있다.

Flow:

`Neon Auth access JWT → Authorization Bearer → JWKS signature/issuer/audience/expiry → JWT sub → app_users.auth_user_id → app_users → complex_memberships`

핵심 정책:

- 로그인 성공과 입주민 인증은 별개
- 최초 유효 login은 필요 시 `app_users`만 bootstrap
- login만으로 `complex_memberships`, resident verified, manager/admin을 만들지 않음
- production에서는 dev header bypass 차단

Contract/auth tests는 green이다.

### PR #18 — Track B / Cloudflare Preview

현재 실제 preview 성공 기준이다.

Preview:

- Worker: `https://track-b-padiem-danjion-api-preview.padiem.workers.dev`
- Frontend: `https://track-b.padiem-danjion-web-preview.pages.dev`
- Health: `/api/health`

최종 Track B evidence:

- Backend CI PASS
- Frontend CI PASS
- Resident Verification CI PASS
- Pre-Infra Integration CI PASS
- Cloudflare Preview PASS
- Worker preview upload PASS
- Pages preview PASS
- Neon DB connectivity PASS
- frontend HTTP PASS
- GET CORS PASS
- OPTIONS preflight PASS

Track B에서 추가로 해결한 실제 배포 이슈:

1. 존재하지 않는 Worker에는 `versions upload`만 할 수 없어 dedicated preview Worker를 guarded one-time bootstrap
2. Pages project 존재 여부를 정확히 판정해 재생성 충돌 방지

Production traffic deploy는 하지 않았다.

### PR #19 — Track C / Google Drive Storage

구현돼 있는 것:

- active storage mode `mock | drive`
- GoogleDriveStorageAdapter
- upload/read/delete/resolvePreview contract
- server-side OAuth refresh-token flow
- public business image / private resident evidence namespace 분리
- MIME/size/count validation
- anonymous public business image는 backend proxy를 통해서만 제공
- resident evidence는 uploader 또는 같은 단지 verified manager/admin만 읽기
- private evidence response `no-store`
- delete는 trash 처리

아직 안 된 것:

- 실제 Padiem Google Cloud OAuth credential 설정
- 실제 Drive folder ID 설정
- 실제 비PII 파일 1개 upload/read/delete smoke

### PR #20 — Track D / Live Release Gate

구현돼 있는 것:

- Neon child-only DB integration harness
- production URL equality refusal
- preview API smoke
- auth negative checks
- resident/admin vertical flow harness
- benefit wallet live flow
- viewport checks
- release/rollback checklist

static/non-live gate는 green이지만 실제 live jobs는 runtime credentials가 없어 아직 전체 실행되지 않았다.

### PR #22 — Track E / A+B+C+D Integration

통합 아키텍처 기준이다.

통합된 것:

- Track A canonical auth
- Track C storage가 Track A `requireActor` 재사용
- Track B CORS/preview config
- Track D release gate
- A/B/C env contract union

현재 PR #22 자체의 통합 판정은 `INTEGRATION_GREEN`이다.

단, PR #22에 합쳐진 Track B head 이후 PR #18에서 실제 Cloudflare bootstrap/reuse fixes가 더 진행됐다. 따라서 PR #22와 PR #18 최신 head 사이에는 시간차가 있다.

## 4. Frontend 상태

### 완료 또는 높은 완성도

- 홈
- 검색
- relation/category filter
- business detail
- 주민혜택
- 단지소식
- 내정보 기반 UX
- business registration 4-step wizard
- application status
- promo materials
- admin application review
- resident verification/admin verification UI
- responsive desktop/mobile
- accessibility gates

### 아직 실제 MVP로 닫히지 않은 부분

#### Neon browser Auth

현재 integration branch의 `src/auth.ts`에서:

- `DevAuthProvider`: 구현
- `NeonAuthProvider`: placeholder

실제 Neon Auth browser session에서 access JWT를 받아 API `Authorization: Bearer`에 붙이는 동작은 아직 미완료다.

따라서 현재 preview는 실제 사용자 login 완성본으로 보면 안 된다.

#### 실제 business image

Backend API/DB에는 representative image object key 설계가 있지만 frontend business card/type까지 live image가 완전 연결된 상태는 아니다.

현재 cinematic hero는 demo sprite 기반이며 큰 화면에서 원본 품질 때문에 흐리게 보일 수 있다.

## 5. Authentication vs Authorization vs Verification

현재 backend 방향은 올바르게 분리되어 있다.

- Authentication: Neon Auth — 사용자가 누구인가
- Product identity: `app_users`
- Apartment authorization: `complex_memberships`
- Resident verification: membership verification status + resident verification records
- Business registration/approval: business application domain
- manager/admin: DB membership/role로 서버 판정

Client가 보내는 `user_id`, `role`, `verified` 값을 권한 근거로 신뢰하지 않는다.

세부 제품정책은 `MVP_AUTH_IDENTITY_VERIFICATION_PLAN_v1.md`를 본다.

## 6. DB 상태

Neon production에는 migration 001~008이 적용됐다.

주의:

- production에는 개발용 seed를 넣지 않음
- production destructive test를 하지 않음
- 최종 mutating preview E2E는 production이 아니라 approved child branch를 사용해야 함

Track E가 명시한 child preview target:

- branch name: `cloudflare-preview-20260808`
- branch id: `br-hidden-frog-azdevrqe`

실제 secret을 등록할 때는 connection string target이 이 child인지 반드시 확인해야 한다.

## 7. Cloudflare 상태

### 실제 완료

Track B preview는 성공했다.

### 아직 안 한 것

- production Worker traffic deployment
- production Pages deployment
- custom production domain 연결
- real Neon browser Auth를 포함한 final preview
- Drive live storage를 포함한 final preview

## 8. Google Drive 상태

Adapter/보안정책/route contract는 구현됐지만 외부 OAuth 설정 때문에 실파일 검증 전이다.

필요 runtime inputs:

- `STORAGE_MODE=drive`
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_PUBLIC_BUSINESS_FOLDER_ID`
- `GOOGLE_DRIVE_PRIVATE_RESIDENT_VERIFICATION_FOLDER_ID`

Browser/Vite에 Google secret을 넣지 않는다.

## 9. 현재 알려진 실환경 Gap

P0 남은 작업:

1. Neon Auth 실제 browser login UI/session
2. Google + 이메일 중 MVP login provider 최종결정 및 구현
3. login user → app_users bootstrap live smoke
4. 입주민 인증 실제 user vertical flow
5. 사업 신청/승인 actual bearer-auth vertical flow
6. Google Drive real OAuth/folder setup
7. representative image frontend 연결
8. approved child DB를 사용한 Cloudflare Track E final preview
9. final resident/admin/business E2E
10. 최종 deployment/runbook 및 동생 인수인계

## 10. 개인정보/보안 기준

공개 surface에 넣지 않는 것:

- 정확한 동/호수
- 주민 인증 원본
- 사업자등록증 원본
- 비공개 개인 연락처
- 관리자 내부 검토 메모
- 개인 실명 + 정확한 세대의 결합정보

Resident evidence와 business public media는 storage namespace와 접근정책을 분리한다.

## 11. 현재 개발 STOP

2026-08-08 20:01 KST 시점에서 신규 제품개발은 잠시 중단한다.

동생이 다음을 보고 판단한 뒤 재개한다.

- 이 문서
- Auth/Identity plan
- PR #22
- PR #17/#18/#19/#20
- 실제 Track B frontend preview

다음 재개 시점의 첫 작업은 신규 기능이 아니라 **인증정책 확정과 실 Neon Auth browser adapter**가 되어야 한다.

## 12. 현재 최종 판정

`CODE_FOUNDATION_STRONG / MVP_LIVE_IDENTITY_AND_FILE_FLOW_INCOMPLETE / DEVELOPMENT_PAUSED_FOR_REVIEW`

즉 현재는 “코드가 거의 없는 prototype”이 아니라, **대부분의 제품 기능과 인프라 contract가 구현되어 있고 실제 로그인/실파일/최종 live vertical flow가 남은 pre-MVP handoff 단계**다.
