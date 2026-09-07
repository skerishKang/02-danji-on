# CTO RESUME STATE — 2026-09-05

STATUS: AUTHORITATIVE RESUME POINT
PURPOSE: 재부팅·세션 교체·작업폴더 유실 시 이 문서 하나로 전체 상태를 복원한다.
RULE: 이 문서가 가리키는 커밋이 유일한 진실의 원천이다. 로컬 임시폴더(handoff zip, Temp 경로)는 진실이 아니다.

---

## 1. 현재 기준 커밋

| 항목 | 값 |
| --- | --- |
| 저장소 | `https://github.com/skerishKang/02-danji-on` |
| 기준 브랜치 | `main` |
| 기준 커밋 | `abbd6e7` — 동생 워크스페이스 import 머지 (#274) |
| 직전 기준 | `c84e543` (TRACK K 머지 #272) ← `4eef813` (#269) ← `bf7b029` (Track I) |
| 문서 통합 | #268 (`fedd364`)로 CTO 산출물 10종 main 병합 완료 |

새로始める 어디서든 이 한 줄이면 복원된다:

```bash
git clone https://github.com/skerishKang/02-danji-on.git
cd 02-danji-on && git log --oneline -1   # abbd6e7 이상(본 문서 병합 커밋 포함)이 보여야 정상
```

---

## 2. 완료·병합된 트랙 (전부 GREEN 판정 완료)

| 트랙 | 내용 | 판정 | 반영 커밋 |
| --- | --- | --- | --- |
| F | official-news 채널 **쓰기** 경로 파생 (`deriveChannel`) | GREEN | `89d67e5` (PR #264) |
| G | R1 패리티 계약 6화면 (24/25/25A/26/27/28) | GREEN | `417016b` (PR #265) |
| H | R2 패리티 계약 4화면 (19/20/21/22) | GREEN | `307ee83` (PR #266) |
| I | 21 대화상세 "대화 신고하기" 구현 (#267) | GREEN | `bf7b029` |
| K | 008 RELOCATED 앵커 정렬 + 공용 자산 배치 (#272) | GREEN | `6993bad` (PR #272), 머지 `c84e543` |
| — | 동생 워크스페이스 import — `muphobia2/danjion` @`1098e77` 루트 1:1 미러 (#274) | MERGED | `91357de`, 머지 `abbd6e7` |
| — | sibling-latest 델타 조사 (read-only) | SUBMITTED (판정 대기) | `feat/sibling-latest-delta-report` (PR #273) |

결과: `v2-current-*` 패리티 계약 **16종** 전부 그린, 백엔드 채널 쓰기 계약 그린, 빌드 그린.
R0 드리프트 행렬이 찾아낸 **코드 수준 개발 공백은 모두 해소**됐다.
동생 저장소(`muphobia2/danjion`) 루트 1:1 미러로 import 완료 — `frontend/`(49) `backend/`(30) `auth-test/`(10), 트리 해시 원본과 일치. 델타 보고서: `04_개발/docs/tracks/TRACK_SIBLING_LATEST_DELTA_REPORT_20260905.md`.

---

## 3. 열려 있는 항목

| 번호 | 상태 | 내용 |
| --- | --- | --- |
| #263 | OPEN / HOLD | 소유자 결정 대기 — 23 이웃온기 웜스 공식, 03 주민혜택 쿠폰 모드 |
| #253 | OPEN / HOLD | 03 주민혜택 표면 — benefit-mode 정책 발명 금지 |
| #139 | OPEN / HOLD | 백엔드 핸드오프 저우선순위 제품 정책 결정 |
| #59 | OPEN / HOLD | 개인정보 처리주체·주민인증·관리자 접근권한 확정 게이트 |
| #245 | OPEN | Post-V2 안정화 리팩터링 웨이브 (다음 개발 후보) |
| — | OPEN (CTO 판정 대기) | sibling-latest 델타: ①변경 11건 반영 방향 ②비화면 추가 반영 여부 ③실기능화와 백엔드 연동 충돌 검토 |
| — | ACTIVE | 동생 협업 — collaborator 권한 완료. **동생 전용 브랜치 `muphobia2/dev`**에서 직접 작업, 브랜치가 작업물. main 병합은 소유자 결정. 가이드 `04_개발/docs/tracks/SIBLING_WORKSPACE_GUIDE_20260905.md`, CTO 프롬프트 `04_개발/docs/tracks/CTO_PROMPT_SIBLING_WORK_ORDER_20260905.md` |

### 2026-09-05 정리 완료 (로컬 실행)
- #267 CLOSED — `bf7b029`로 구현·병합 완료
- #246 CLOSED — R0 + F/G/H/I로 실질 완료
- #262 CLOSED(superseded) — #268이 CTO 산출물 10종 main 병합
- #269 MERGED — 게이트 러너 Windows npm spawn 수정 (`shell:true`)

### 개발 착수 금지 (HOLD — 소유자 결정 없이는 구현·추론 금지)
- **23 이웃온기**: 웜스 점수 공식 / 이벤트 가중치 / 페널티
- **03 주민혜택 쿠폰**: reserve·onsite·coupon delivery-mode 서버 권한

---

## 4. 검증 방법 (CTO 게이트)

```bash
# 격리 워크트리에서 대상 ref 의 typecheck + 계약 + build 를 돌려 판정한다.
node 04_개발/scripts/cto-gate-runner.mjs --ref origin/main --quick

# 회귀 분리(베이스와 대상 비교)
node 04_개발/scripts/cto-gate-runner.mjs --ref <대상브랜치> --base origin/main
```

주의: `4eef813`(#269) 이전 러너는 Windows에서 npm spawn 실패(ENOENT)로 전 단계 FAIL을 낸다.
`npm install` 단계부터 한 줄도 실행 없이 FAIL하면 최신 main으로 업데이트할 것.

수동 게이트:

```bash
# backend
cd 04_개발/backend && npm ci
npm run typecheck && npm run test:complex-news-channel && npm run test:complex-news-channel-write
# frontend
cd ../frontend && npm ci
npm run typecheck && npm run test:v2-complex-news-contract && npm run build
```

주의: DB 실연결 테스트(`*-postgres-lifecycle.sh`, `run-live-db-integration.sh`)는 실 DB가 필요해
게이트 러너에서 제외된다. 스키마/계약/타입 레벨이 게이트의 범위다.

---

## 5. 문서 지도 (이 폴더가 CTO 산출물 전체다)

| 파일 | 역할 |
| --- | --- |
| `04_개발/docs/v2/R0_DRIFT_MATRIX_20260905.md` | 30화면 드리프트 행렬 (분석 출발점) |
| `04_개발/docs/tracks/TRACK_F_..._WORK_ORDER.md` | 채널 쓰기 작업지시 (완료) |
| `04_개발/docs/tracks/TRACK_G_R1_PARITY_SLICE_WORK_ORDER.md` | R1 패리티 (완료) |
| `04_개발/docs/tracks/TRACK_H_R2_PARITY_SLICE_WORK_ORDER.md` | R2 패리티 (완료) |
| `04_개발/docs/tracks/TRACK_I_MESSAGE_REPORT_WORK_ORDER.md` | 대화 신고 (완료) |
| `04_개발/docs/tracks/TRACK_SIBLING_LATEST_DELTA_REPORT_20260905.md` | sibling 델타 조사 보고서 (판정 대기) |
| `04_개발/docs/tracks/SIBLING_WORKSPACE_GUIDE_20260905.md` | 동생 워크스페이스 가이드 (작업 기준) |
| `04_개발/docs/tracks/CTO_PROMPT_SIBLING_WORK_ORDER_20260905.md` | CTO 프롬프트 — 챗GPT에 붙여넣으면 동생 작업지시 가능 |
| `04_개발/docs/tracks/LOCAL_IMPLEMENTER_PROMPT.md` | 로컬 구현 모델 지시 템플릿 |
| `04_개발/docs/CTO_VERDICT_TRACKS_GH_20260905.md` | G/H 판정 기록 |
| `00_공통기준문서/03_의사결정기록_2026-09-05.md` | 보류 결정 기록 (#263) |
| `04_개발/scripts/cto-gate-runner.mjs` | 게이트 자동 판정 도구 |

---

## 6. 운영 규칙 (재확인)

1. **전달 채널은 GitHub뿐.** rclone/Google Drive/채팅 첨부는 CTO가 읽을 수 없다.
2. 로컬은 `feat/...` 브랜치에 푸시하고 **Draft PR**만 연다. 병합은 CTO 승인 후.
3. CTO 산출물(작업지시서·판정·게이트)은 **반드시 main에 병합**한다 — 브랜치에 남기면 로컬이 못 찾는다.
4. 전체 브랜치를 받아야 할 때: `git fetch origin '+refs/heads/*:refs/remotes/origin/*'`
5. HOLD 항목은 소유자 결정 없이는 어떤 모델도 확정하지 않는다.
