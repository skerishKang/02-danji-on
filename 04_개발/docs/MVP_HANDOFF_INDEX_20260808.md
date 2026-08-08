# DanjiOn MVP Handoff Index — 2026-08-08

> 이 문서는 2026-08-08 개발 일시중지 시점의 **동생 검토용 시작점**이다.
> 현재 제품 코드는 여러 Draft PR/stacked branch에 분산되어 있으므로 `main`만 보고 현재 수준을 판단하면 안 된다.

## 1. 지금 어디를 보면 되는가

검토 순서는 아래를 권장한다.

1. 이 문서 — 전체 지도
2. `04_개발/docs/MVP_CURRENT_STATUS_20260808.md` — 현재 실제 구현/배포/미완료 상태
3. `04_개발/docs/MVP_AUTH_IDENTITY_VERIFICATION_PLAN_v1.md` — 로그인·입주민·사업자 인증 의사결정안
4. PR #22 `[Track E] Live stack integration: Auth + Preview + Drive + Release Gate` — A/B/C/D 통합 코드
5. PR #18 `[Track B] Padiem Cloudflare preview deployment` — 현재 실제 Cloudflare preview 성공 근거
6. PR #17 / #19 / #20 — Auth / Drive / Live Gate 세부 구현
7. PR #4~#10 — 현장시연 UX와 주민→등록→승인→재발견 전체 제품 흐름 발전 이력

## 2. 현재 검토 기준 브랜치

- 통합 코드 기준: `feat/live-stack-integration`
- 통합 PR: #22 — Draft / DO NOT MERGE
- 이 handoff 문서 브랜치: `docs/mvp-handoff-checkpoint-20260808`
- `main`은 현재 개발 진행상황 전체를 대표하지 않는다.

## 3. 한눈에 보는 현재 수준

현재 MVP는 **기능/코드 기반은 상당 부분 구현됐지만 실제 사용자 로그인과 실제 파일 저장까지 완전한 실사용 한 바퀴는 아직 닫히지 않은 상태**다.

대략적인 제품 완성도 판정:

- Frontend / 주요 UX: 약 90%
- Backend API: 약 90%
- Neon DB/schema: 약 95%
- Cloudflare Preview: 실제 배포 성공
- 주민 인증 코드/화면: 약 80~85%
- 사업자 신청/승인: 약 85~90%
- 실 Neon Auth 브라우저 로그인: 미완료
- Google Drive storage adapter: 코드 있음, 실 OAuth 파일-flow 미검증
- 실제 business 대표사진 표시: 미완료
- 최종 live E2E: 미완료

전체를 “사람이 실제 가입해 쓰는 MVP” 기준으로 보면 약 **70~75%** 수준으로 본다. 이 수치는 공식 품질지표가 아니라 2026-08-08 handoff를 위한 작업량 추정치다.

## 4. 실제 Preview

### Frontend

`https://track-b.padiem-danjion-web-preview.pages.dev`

### Worker

`https://track-b-padiem-danjion-api-preview.padiem.workers.dev`

Worker는 웹사이트가 아니라 API 서버이므로 `/`에서 `NOT_FOUND`가 나오는 것은 현재 계약상 정상이다. 상태 확인은:

`https://track-b-padiem-danjion-api-preview.padiem.workers.dev/api/health`

를 사용한다.

현재 Track B에서 health / Neon DB connectivity / frontend HTTP / CORS / preflight가 PASS했다.

## 5. 중요한 주의점

### Preview가 곧 완성 MVP는 아니다

현재 성공한 Track B frontend build는 실제 Neon browser login/Drive live file-flow를 모두 사용한 최종 제품본이 아니다.

특히 현재 통합 코드에서 browser Neon Auth adapter는 아직 실제 session/token 연결 전 단계이고, Track B preview는 auth/storage의 최종 live 구성을 의미하지 않는다.

### PR #22와 PR #18의 시간차

PR #22는 A/B/C/D를 통합했지만, PR #22 작성 이후 PR #18에서 Cloudflare 최초 Worker bootstrap 및 Pages project reuse 관련 추가 수정이 진행되어 최종 head가 변경됐다.

따라서:

- PR #22 = 현재 통합 아키텍처 기준
- PR #18 최신 head = 현재 실제 Cloudflare preview 성공 기준

으로 읽어야 한다.

### DB secret 혼동 금지

Track E는 final live/mutating preview 테스트에 **Neon child preview DB**를 요구한다.

`DANJION_PREVIEW_DATABASE_URL`은 반드시 승인된 child branch를 가리켜야 하며 production DB URL과 혼용하면 안 된다.

기존 `DATABASE_URL` secret을 이름만 바꿔 복사하지 말고 실제 target을 먼저 확인한다.

## 6. 개발 일시중지 상태

2026-08-08 20:01 KST 기준 제품 개발은 **의도적으로 일시중지**한다.

이 checkpoint 이후에는 동생이 GitHub와 preview를 검토하고 다음을 논의한 뒤 개발을 재개한다.

우선 논의 대상:

1. MVP 로그인 수단 — Google + 이메일을 1차안으로 할지
2. 입주민 인증 — 1회/세대별 code·QR + 관리자 수동 확인의 이중 경로
3. 외부 사업자 / 주민 사업자 / 주민가족 사업자의 승인 정책
4. Google Drive를 MVP storage로 실제 연결할지
5. 실제 대표사진/증빙 파일의 privacy와 운영 방식
6. MVP 전달 시 production까지 갈지 preview 승인본으로 먼저 전달할지

## 7. 개발 재개 시 P0 순서

의사결정 후 아래 순서가 권장된다.

1. 실 Neon Auth browser login/session adapter
2. login → `app_users` bootstrap 실검증
3. 입주민 신청 → 관리자 승인 → verified 실검증
4. 사업자 신청 → 관리자 승인 → public business 실검증
5. Google Drive real OAuth + 1개 비PII 파일 smoke
6. business 대표사진 object key → backend proxy → frontend 표시
7. Neon child + Cloudflare preview에서 전체 vertical E2E
8. 동생 인수인계용 최종 README/runbook

## 8. 현재 금지 상태

이 checkpoint에서는 다음을 하지 않는다.

- production Cloudflare deploy
- production test seed
- production DB destructive test
- R2 도입
- Draft PR merge
- 실제 주민 개인정보를 test fixture로 업로드
- 인증정책 확정 전 로그인 UI를 임의 구현

---

**판정:** 현재 GitHub에는 제품 기능과 인프라 구현 근거가 충분히 있으며, 이 문서와 두 companion 문서를 먼저 읽으면 동생이 현재 수준·남은 범위·핵심 의사결정 지점을 파악할 수 있다. 다음 개발은 동생 검토 후 재개한다.
