# 📐 Issue #246 R0 정합성 분석 보고서 (Read-Only)

- 기준: 디자인 핸드오프 `008_프론트엔드점검1기_통합수정본_20260904.zip` (30개 화면) vs 현재 V2 코드베이스 (`main` a4021f0, #261 머지 완료)
- 성격: R0 읽기 전용 분석. 프로덕션 코드·마이그레이션 수정 없음. 정책 블로커(#139) 없는 좁은 R1 슬라이스 제안.
- 작성일: 2026-09-05

---

## 1. 코드베이스 스캔 결과 요약

- **셸**: `V2IntegratedApp.tsx` 가 통합 셸. 14개 통합 포털이 `main.tsx` v2 루트에 오버레이로 마운트됨(V2AuthEntryPortal, V2ComplexNewsPortal, V2ResidentNewsPortal, V2MySummaryPortal, V2ActivityPortal, V2SettingsPortal, V2NotificationsPortal, V2MessagesIntegration, V2ResidentProfileIntegration, V2BusinessShareIntegration, V2BusinessReviewsIntegration, V2InquiriesPortal, V2HouseholdPortal, V2AccountClosurePortal).
- **제품 흐름**: `flows/V2ProductFlows.tsx` — discover/results/detail/benefits/register/promo/operator 7종. `V2App.tsx` — V2FlowView 7종.
- **패리티 계약 테스트 6종** (tests/): shell, home, shops, complex-hub, resident-news, neighbor-conversation.
- **잔여 화면 클라이언트**: 각 화면 전용 `*-client.ts` 존재(resident-settings/summary/inquiries/messages/notifications/profile/safety, household-family 등). 전부 `VITE_DATA_MODE === 'api'` 스위치로 실 API(`/api/v1/...`)와 mock 겸용.
- **백엔드 라우트**: 잔여 화면 대응 라우트 확인됨 — `resident-settings-v1.ts`, `resident-summary-v1.ts`, `inquiries-v1.ts`, `resident-messages-v1.ts`, `resident-notifications-v1.ts`, `resident-activity-v1.ts`, `resident-blocks-v1.ts`, `resident-safety-reports-v1.ts`, `resident-profile-v1.ts`, `household-family-v2.ts`, `business-share-v1.ts`, `business-reviews-v1.ts` 등.

## 2. Drift 행렬 (20260904 디자인 vs 현재 V2)

| # | 화면 (핸드오프) | 현재 V2 구현 | 백엔드 API | 상태 | Drift 유형 | 비고 |
|---|---|---|---|---|---|---|
| 00 | APP_390 통합검토 | — | — | — | — | QA 전용, 구현 기준 아님 (README 명시) |
| 01 | 이웃가게 발견 | V2CurrentShopDiscovery | core-v1 businesses | ✅ PARITY_READY | — | shops 계약 커버 |
| 02 | 이웃가게 상세 | V2CurrentShopDetail | core-v1 businesses/:id | ✅ PARITY_READY | — | shops 계약 커버 |
| 03 | 주민혜택 쿠폰 | V2 benefits + benefit-wallet | benefit-wallet-v1 | ⚠️ PARTIAL | 시각/동작 + 정책 | #253 HOLD: delivery-mode 구분자 없음, #139 소유자 정책 승인 전 풀패리티 불가 |
| 04 | 데일리홈 | V2CurrentShopDiscovery 홈 | — | ✅ PARITY_READY | — | home 계약 커버 |
| 05 | 우리단지 첫화면 | V2ComplexNewsPortal | resident-news-v1 / complex | ✅ PARITY_READY | — | complex-hub 계약 커버 |
| 06 | 단지온공지 목록 | V2ComplexNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | complex-hub 계약 커버 |
| 07 | 단지온공지 상세 | V2ComplexNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | complex-hub 계약 커버 |
| 08 | 아파트소식 목록 | V2ComplexNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | complex-hub 계약 커버 |
| 09 | 회장인사 상세 | V2ComplexNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | complex-hub 계약 커버 |
| 10 | 주민소식 목록 | V2ResidentNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | resident-news 계약 커버 |
| 11 | 주민소식 상세 | V2ResidentNewsPortal | resident-news-v1 | ✅ PARITY_READY | — | resident-news 계약 커버 |
| 12 | 이웃대화 첫화면 | V2 neighbor-conversation | community-resident-v1 | ✅ PARITY_READY | — | neighbor-conversation 계약 커버 |
| 13 | 이웃대화 글상세 댓글 | V2 neighbor-conversation | community-replies-v1 | ✅ PARITY_READY | — | neighbor-conversation 계약 커버 |
| 14~17 | 글쓰기 4종 | V2 쓰기 플로우 | community-resident-v1 | ✅ PARITY_READY | — | neighbor-conversation 계약 커버 |
| 18 | 공통앱셸 | V2IntegratedApp | — | ✅ PARITY_READY | — | shell 계약 커버 |
| 19 | 내정보 메인 | V2MySummaryPortal / V2MySummaryPanel | resident-summary-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 프로필+나의활동+이용설정. 계약 테스트 없음 |
| 20 | 메시지함 목록 | V2MessagesIntegration | resident-messages-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 안 읽은 메시지. 계약 테스트 없음 |
| 21 | 메시지 대화상세 | V2MessagesIntegration | resident-messages-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 답장/대화신고. 계약 테스트 없음 |
| 22 | 주민 공개프로필 | V2ResidentProfileIntegration | resident-profile-v1 / safety-reports-v1 / blocks-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 메시지/신고. 계약 테스트 없음 |
| 23 | 이웃온기 | ❌ 없음 (매핑 불가) | — | ❌ MISSING | 구현 공백 | 전체 프론트에서 "온기" 시그니처 없음. R1 후보 |
| 24 | 설정 | V2SettingsPanel + V2AccountClosurePortal | resident-settings-v1 / account-lifecycle-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 글자크기/알림설정/개인정보·계정/약관/탈퇴. 계약 테스트 없음 |
| 25 | 1:1문의 | V2InquiriesPortal | inquiries-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 내문의. 계약 테스트 없음 |
| 25A | 신청제보 | V2RegistrationFlow / V2BusinessShareIntegration / V2BusinessReviewsIntegration | resident-application-v1 / business-share-v1 / business-reviews-v1 / shop-recommendations-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 가게등록+제보+확인서류+가게사진. 계약 테스트 없음 |
| 26 | 우리집연결 | V2HouseholdPortal | household-family-v2 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 동호수/가족초대. 계약 테스트 없음 |
| 27 | 알림함 | V2NotificationsPortal / V2NotificationsPanel | resident-notifications-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 새알림. 계약 테스트 없음 |
| 28 | 나의활동 | V2ActivityPortal / V2ActivityPanel | resident-activity-v1 | ⚠️ DRIFT_SUSPECTED | 시각/상호작용 (비계약) | 요구: 나의활동. 계약 테스트 없음 |

**범례**: PARITY_READY = 계약 테스트로 커버, DRIFT_SUSPECTED = 구현 존재 + 백엔드 라우트 존재하나 시각/상호작용 계약 미검증, MISSING = 코드 매핑 없음.

## 3. 핵심 발견

1. **전체 30화면 중 18개(01~18)는 계약 테스트로 이미 커버** — R0 대상 drift는 11개(03, 19~28, 25A)에 집중.
2. **잔여 10개 화면(19~28, 25A)은 전부 구현 존재 + 전용 백엔드 라우트 존재** → "구현 공백"이 아니라 **시각/상호작용 계약 미검증** 상태. 이는 R1에서 1:1로 좁게 보정 가능.
3. **유일한 진짜 공백: 23 이웃온기** — 코드 시그니처("온기")가 프론트·백엔드 모두에 없음. 신규 구현이므로 R1 좁은 슬라이스에 포함하려면 백엔드 추가 필요 → 별도 판단 요청.
4. **정책 블로커는 03 주민혜택 쿠폰 단독** (#253/#139). 나머지 잔여 화면에는 정책 블로커 없음.

## 4. R1 좁은 슬라이스 제안 (정책 블로커 제외)

우선순위는 **시각/상호작용 drift 위주 + 백엔드 준비 + 계약 테스트 신규** 기준:

1. **설정(#24)** — V2SettingsPanel + V2AccountClosurePortal 이미 구현, resident-settings-v1 준비 → 화면 대조·계약 테스트 추가만 필요. 가장 낮은 위험.
2. **알림함(#27)** — V2NotificationsPanel 구현 + resident-notifications-v1 준비 → 계약 테스트 추가.
3. **1:1문의(#25)** — V2InquiriesPortal 구현 + inquiries-v1 준비 → 계약 테스트 추가.
4. **나의활동(#28)** — V2ActivityPanel 구현 + resident-activity-v1 준비 → 계약 테스트 추가.
5. **우리집연결(#26)** — V2HouseholdPortal 구현 + household-family-v2 준비 → 계약 테스트 추가.
6. **신청제보(#25A)** — V2RegistrationFlow/Share/Reviews 구현 + 3개 라우트 준비 → 계약 테스트 추가.

(23 이웃온기는 백엔드 신규 포함 여부를 CTO가 판단 후 별도 슬라이스로 분리 제안.)

## 5. CTO 확인 요청

- [ ] 잔여 10개 화면(19~28, 25A)을 R1에서 "계약 테스트 추가 + 시각 대조 보정" 위주로 진행해도 되는가?
- [ ] 23 이웃온기: 신규 구현(프론트+백엔드)을 이번 스프린트에 포함할지, 별도 슬라이스로 미룰지?
- [ ] 03 주민혜택 쿠폰은 #139 정책 승인 전까지 HOLD 유지 확인?
