# Track H — R2 패리티 슬라이스 작업지시서 (CTO 판정)

Status: `OPEN / DO NOT MERGE`
R0 기준: `04_개발/docs/v2/R0_DRIFT_MATRIX_20260905.md` (#246)
Implementer: 로컬 모델 (개발)
Owner(gate): 웹 모델 (CTO)

## 1. CTO 판정 (R2)

TRACK G(R1, 6화면)가 `TRACK_G_R1_PARITY_GREEN`으로 통과했다. R0에서 **DRIFT_SUSPECTED로 남은 화면 중
아직 패리티 계약이 없는 3종(19, 20/21, 22)을 다음 슬라이스로 진행한다.

- 19 내정보 메인 → `V2MySummaryPanel` + `V2MySummaryPortal` / `resident-summary-v1`
- 20 메시지함 목록 → `V2MessagesIntegration` / `resident-messages-v1`
- 21 메시지 대화상세 → `V2MessagesIntegration` / `resident-messages-v1`
- 22 주민 공개프로필 → `V2ResidentProfileIntegration` / `resident-profile-v1` + `resident-messages-client` + `resident-safety-client`

모두 **구현 존재 + 전용 백엔드 라우트 존재**를 확인했다(구현 공백 아님, 계약 미검증 상태).
TRACK G와 동일한 패턴: **패리티 계약 테스트 추가 + 드리프트 지점 소규모 보정**. 인증/스키마/백엔드 로직 무변경.

## 2. 구현 범위

기존 `frontend/tests/v2-current-*-contract.mjs` 방식/스타일을 재사용해 신규 계약 테스트 4종을 추가한다.
(19 / 20 / 21 / 22 — 20과 21은 같은 컴포넌트지만 별도 계약으로 기준을 구분할 수 있다.)

| # | 화면 | 기준 앵커(R0) | 컴포넌트 | 백엔드 |
|---|---|---|---|---|
| 19 | 내정보 메인 | 프로필(세대 구성원/세대 대표/인증완료/확인중) + 나의활동 + 이용설정 | V2MySummaryPanel | resident-summary-v1 |
| 20 | 메시지함 목록 | 안 읽은 메시지 | V2MessagesIntegration | resident-messages-v1 |
| 21 | 메시지 대화상세 | 답장/대화신고(신고 유형) | V2MessagesIntegration | resident-messages-v1 |
| 22 | 주민 공개프로필 | 공개소개/메시지/차단/신고 | V2ResidentProfileIntegration | resident-profile-v1 / safety |

## 3. 계약 테스트가 반드시 커버할 항목

각 테스트는 다음을 명시적으로 assert한다(기존 TRACK G 패턴):

- **기준 앵커**: `CURRENT_008_*_AUTHORITY` 상수 + 각 화면의 요구 라벨 존재.
- **정식 클라이언트**: `residentSummaryClient`/`residentMessagesClient`/`residentProfileClient`/`residentSafetyClient`등 카노니컬 authority 사용.
- **마운트 표면**: `.v2-profile-dialog` 영속 + `MutationObserver` 반응성(해당 포털).
- **상호작용 라벨**: 예) 19 `세대 구성원/세대 대표/인증 완료/확인 중`, 20 `안 읽음`, 21 `메시지를 보냈습니다 ./삭제된 메시지입니다.` + `danjion:v2-open-conversation`, 22 신고 유형(`개인정보 침해/명예훼손 우려/스팸/욕설·괴롭힘/위협/기타`) + `danjion:v2-resident-blocked`.
- **보안 경계**: `authenticatedFetch`(인증 authority), `localStorage/sessionStorage/indexedDB` 금지.
- **제외(HOLD) 가드**: `이웃온기|주민혜택 쿠폰`(23/03) 유출 방지.
- **마운트 정합**: `main.tsx`가 해당 포털을 v2 루트에 mount.

## 4. 반드시 먼저 읽을 것

- `04_개발/docs/v2/R0_DRIFT_MATRIX_20260905.md`
- `04_개발/docs/tracks/TRACK_G_R1_PARITY_SLICE_WORK_ORDER.md` (이미 통과한 R1 패턴)
- `04_개발/frontend/tests/v2-current-settings-contract.mjs` 등 R1 계약 테스트 참조
- `04_개발/frontend/src/v2/integration/V2MySummaryPanel.tsx`, `V2MessagesIntegration.tsx`, `V2ResidentProfileIntegration.tsx`
- `04_개발/frontend/src/{resident-summary,resident-messages,resident-profile,resident-safety}-client.ts`

## 5. 완료 Gate

- 신규 계약 4종(19/20/21/22) 실행 시 `PASS`.
- `npm run typecheck`(전체 parity) 그린. `npm run build` 그린.
- 기존 `v2-current-*-contract` 6종(R1) + `test:v2-complex-news-contract` 회귀 그린.
- 제외 항목(23/03)이 코드에 추가되지 않음.
- 수정한 시각/상호작용은 소규모 보정이며 기준 의도를 훼손하지 않음.

## 6. 금지(하드 경계)

- migration/스키마/인증/백엔드 로직 변경 금지. 백엔드 무변경.
- 23 이웃온기 / 03 주민혜택 쿠폰 구현·추론 금지.
- `localStorage`/`sessionStorage`/`indexedDB` 영속 금지.
- production 쓰기/배포/시드, secret 커밋 금지.
- PR merge 금지(항상 Draft).

## 7. 제출 형식

Draft PR 유지, PR body에: 화면별 계약 테스트 경로, 시각/상호작용 보정 내역, frontend typecheck/build 결과,
R1 + complex-news 회귀 그린 여부, 23/03 미변경 확인, 최종 판정 요청 `TRACK_H_R2_PARITY_GREEN` 또는 `BLOCKED`.
`DO NOT MERGE.` `PRODUCTION_READY` 선언 금지.
