# CTO 판정 기록 — TRACK G / TRACK H (R1·R2 패리티 슬라이스)

- 기준: `R0_DRIFT_MATRIX_20260905.md` (#246) / 작업지시서 `TRACK_G_*`, `TRACK_H_*`
- 베이스: `origin/main` = `a4021f0`
- 판정일: 2026-09-05

## 1. TRACK G (R1, 6화면) — `TRACK_G_R1_PARITY_GREEN`

PR #265 `feat/track-g-r1-parity-slice` @ `5d0e36e` (Draft, 미병합)
- 신규 계약: settings(24) / notifications(27) / inquiries(25) / activity(28) / household(26) / registration(25A) 전부 PASS.
- R1 6종 회귀 + complex-news + typecheck + build PASS.
- 인증/스키마/백엔드/migration 무변경. 23/03 미접촉. → **수용(ACCEPT).**

## 2. TRACK H (R2, 19/20/21/22) — `TRACK_H_R2_PARITY_GREEN` (조건부)

PR #266 `feat/track-h-r2-parity-slice` @ `18ea125` (Draft, 미병합)
- 신규 계약: summary(19) / messages(20) / conversation(21) / profile(22) 전부 PASS.
- 기존 6종 + complex-news + typecheck + build PASS. 23/03 미접촉.
- 인증/스키마/백엔드/migration 무변경. → **계약/회귀 레벨은 GREEN으로 수용.**

### ⚠️ 조건부 — 21 "대화 신고하기" 실제 구현 공백 (MISSING)

판정을 GREEN으로 발행하되, 다음은 **실제 구현 공백**이며 로컬이 정직하게 보고했고,
제 TRACK H 지시서의 기준 앵커(답장/대화신고) 중 **"대화 신고"는 미충족**이다.

- 근거:
  - `V2MessagesIntegration.tsx` 에 신고/`report`/`abuse`/`defamation` 등 **엄음** (block 이벤트 수신만 존재).
  - `resident-messages-v1.ts` 에 대화 신고 라우트 **없음** (block/message-block만 존재).
  - frontend `대화신고` 시그니처는 community 게시글 신고(`V2CommunityView.tsx`)에만 존재.
- 008 기준: 로컬이 계약의 `CURRENT_008_CONVERSATION_AUTHORITY.anchors`에 `[..., '대화 신고하기', ...]`을
  스스로 명시함 → **기준(008)에 대화 신고가 요구됨을 인정**. 그러나 본문 assert는 deep-link/메시지
  문자열/스레드 훅만 검증하고 **"대화 신고"는 검증하지 않음** (anchors의 length>0 검사뿐).

### 결론 + 후속 처리

- 계약 테스트 4종은 양호. 회귀·빌드 그린. → **TRACK_H_R2_PARITY_GREEN (계약 레벨)**.
- **21 메시지 대화상세의 "대화 신고"기능은 신규 구현(프론트 `V2MessagesIntegration` + 백엔드
  `resident-messages`/`safety` report)이 필요**하며, R2의 "계약 추가 + 소규모 보정" 범위를 벗어남.
- 따라서 별도 트랙(신규 구현)으로 분리한다. `#263`의 23/03 HOLD와 **별개** — 대화신고는 안전/중재
  기능으로, owner-decision(`#59` 개인정보·중재 게이트)과 연계 대상.

## 3. 종합

- TRACK F / G / H 모두 **Draft PR 유지, 미병합**.
- H는 계약 레벨 GREEN이되, 21 대화신고 MISSING을 후속 트랙으로 분리.
- F/G/H 병합(main)은 **아직 유보** (소스 잠금 규율 + 21 MISSING 해소 전 메인 동기화는 재작업 유발).

## 4. 다음 행동

- 로컬에게 TRACK I(신규 구현) 지시: 21 메시지 대화상세에 "대화 신고" 추가
  (프론트 신고 UI + 백엔드 `resident-messages`/`safety-report` 연동 + 계약 테스트).
- 단, 신고는 안전/중재 기능이므로 owner-decision(#59) 개인정보·중재 범위를 확인 후 진행 여부 결정.
