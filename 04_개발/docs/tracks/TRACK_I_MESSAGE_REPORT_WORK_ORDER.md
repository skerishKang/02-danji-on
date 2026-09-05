# Track I — 21 메시지 대화상세 "대화 신고하기" 구현 작업지시서 (CTO 판정)

Status: `OPEN / DO NOT MERGE`
이슈: `#267`
Implementer: 로컬 모델 (개발)
Owner(gate): 웹 모델 (CTO)
베이스: `origin/main` (= `307ee83`, F/G/H 병합 완료)

## 1. CTO 판정 — 백엔드 이미 준비됨, 프론트 클라이언트만 확장

정적 검토 결과, **백엔드는 이미 메시지 신고를 완비**했다. 프론트 클라이언트 확장 + 대화상세 UI만 남은 소규모 작업이다.

### 확정된 근거 (코드 검증)
- `backend/src/resident-safety-reports-v1.ts`
  - `type ReportTargetType = 'post' | 'comment' | 'resident' | 'message' | 'review'` — **`message` 포함**
  - `submitNonCommunityReport(... targetType: 'message', ...)` — 메시지 신고 처리 경로 존재
  - `nonCommunityTargetExists(... targetType:'message')` — `messages m`, reporter conversation membership 검증
  - `targetTypeForRow` 가 `row.message_id` → `'message'` 반환
  - migration에 `uq_resident_safety_open_message_report` 제약 (open 중복신고 방지)
- `backend/tests/resident-safety-reports-contract.mjs`
  - `'message report must require reporter conversation membership'`
  - `'resident/message/review reports must use the non-community safety store'`
- `frontend/src/resident-safety-client.ts`
  - **`reportResident()`만 노출** — `reportMessage()` 없음 ← 여기만 확장하면 됨.
- PR #265/#266의 `v2-current-profile-contract`(22)가 `reportResident` 사용 — 이미 그린.

## 2. 구현 범위

### 2.1 프론트 클라이언트 확장 (`frontend/src/resident-safety-client.ts`)
`reportMessage(messageId: string, reason: ResidentReportReason, detail?: string)` 추가.
기존 `reportResident`와 동일 패턴:
```ts
async reportMessage(messageId: string, reason: ResidentReportReason, detail?: string): Promise<'submitted' | 'already_reported' | string> {
  if (!API_MODE) {
    const key = `message:${messageId}`;
    if (mockReports.has(key)) return 'already_reported';
    mockReports.add(key);
    return 'submitted';
  }
  const data = await request<Record<string, unknown>>(`/api/v1/me/reports?${query()}`, {
    method: 'POST',
    body: JSON.stringify({ targetType: 'message', targetId: messageId, reason, detail: detail?.trim() || undefined })
  });
  return String(data.status ?? 'submitted');
}
```

### 2.2 대화상세 UI (`frontend/src/v2/integration/V2MessagesIntegration.tsx`)
대화 스레드에 **"대화 신고하기"** 진입점 추가. 신고 유형(22 주민공개프로필과 동일 재사용):
`개인정보 침해 / 명예훼손 우려 / 스팸 / 욕설·괴롭힘 / 위협 / 기타`.
- 신고 시 `residentSafetyClient.reportMessage(conversationId or messageId, reason, detail)`
- 신고 대상 ID는 **스레드/대화(conversation) 기준** — backend `nonCommunityTargetExists`의 message 검증과 일치하도록
  backend가 기대하는 targetId 형식(메시지 id 또는 대화 id)을 확인 후 사용.
- 신고 후 피드백(접수됨 / 이미 신고됨), 중복신고는 `already_reported` 표시.
- 기존 `danjion:v2-resident-blocked`(차단) 이벤트는 그대로 유지.

### 2.3 계약 테스트 확장 (`frontend/tests/v2-current-conversation-contract.mjs`)
기존 `CURRENT_008_CONVERSATION_AUTHORITY.anchors`에 이미 `'대화 신고하기'`가 있으므로, **본문 assert에 "대화 신고" 검증 추가**:
- `reportMessage`/`residentSafetyClient.reportMessage` 사용
- 신고 유형 6종 존재
- 기존 deep-link/메시지/스레드 훅은 유지

### 2.4 package.json / typecheck
필요 시 `v2-current-conversation-contract` 변경은 기존 스크립트 재사용(새 스크립트 불필요).
단, 컨트랙트 테스트가 `resident-safety-client`의 `reportMessage`를 확인하도록 보강.

## 3. 반드시 먼저 읽을 것
- `04_개발/backend/src/resident-safety-reports-v1.ts` (message 신고 경로)
- `04_개발/backend/src/resident-messages-v1.ts` (conversation/message id)
- `04_개발/frontend/src/resident-safety-client.ts`
- `04_개발/frontend/src/v2/integration/V2MessagesIntegration.tsx`
- `04_개발/backend/tests/resident-safety-reports-contract.mjs` (message report 컨트랙트)
- `04_개발/frontend/tests/v2-current-conversation-contract.mjs`

## 4. 완료 Gate
- backend: `npm run typecheck` + `test:resident-safety-reports` 그린.
- frontend: `npm run typecheck`(전체) + `npm run build` 그린 + `test:v2-current-conversation-contract` 그린.
- 신고 유형 6종 + `reportMessage` 어서션 추가된 `v2-current-conversation-contract` PASS.
- 기존 v2-current 16종 회귀 그린.
- 23/03 미접촉, migration/schema 무변경.

## 5. 금지(하드 경계)
- migration/schema 변경 금지. 백엔드 로직 재작성 금지(이미 완비 — 프론트만).
- 23 이웃온기 / 03 주민혜택 쿠폰 구현·추론 금지.
- `localStorage`/`sessionStorage`/`indexedDB` 영속 금지.
- production 쓰기/배포/시드, secret 커밋 금지.
- PR merge 금지(항상 Draft).

## 6. 제출 형식
Draft PR, PR body: 변경 파일, 추가한 `reportMessage` + 신고 UI, 테스트 결과,
backend `test:resident-safety-reports` 그린, frontend full typecheck/build 그린,
v2-current 16종 회귀 그린, 최종 판정 요청 `TRACK_I_MESSAGE_REPORT_GREEN` 또는 `BLOCKED`.
`DO NOT MERGE.` `PRODUCTION_READY` 선언 금지.
