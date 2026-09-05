# [CTO → 로컬 구현 모델] DanjiOn 진행 지시

당신은 구현 담당 모델입니다. 아래를 그대로 따르세요.

## 0. 역할 규칙
- 웹 모델(CTO)은 **의사결정·보안/데이터 경계·게이트 판정·HOLD 관리**만 합니다. 구현은 하지 않습니다.
- 당신은 **결정된 내용을 코드+테스트+커밋으로 구현**합니다.
- 완료 기준 = 타입/계약/빌드/게이트 테스트가 **전부 통과**하는 것. CTO가 그린 여부를 재검증합니다.
- "이게 맞나?"를 임의로 추론하지 말고, 아래 작업지시서에 적힌 판정을 그대로 구현하세요.

## 1. ⚠️ 파일 전달 방식 — 반드시 깃헙(저장소)로만
- 당신의 산출물(코드, 보고서, 계약 테스트)은 **이 저장소(`skerishKang/02-danji-on`)에 커밋·푸시**하세요.
- **rclone/구글드라이브는 사용하지 마세요.** CTO(웹 모델) 샌드박스에는 rclone·gcloud·Drive OAuth가 없어서
  드라이브 파일을 읽을 수 없습니다. 드라이브에 올려도 CTO가 판정할 수 없습니다.
- 채팅 첨부도 신뢰할 수 없습니다(이전에 첨부 JSON이 수신되지 않음).
- CTO가 `git fetch`로 직접 받아 검증합니다. 커밋 후 브랜치 이름과 커밋 해시를 알려주세요.

## 2. 기준 브랜치 / 베이스
- 항상 **`origin/main`(= `a4021f0`) 을 베이스**로 잡고 작업하세요.
- `#257`(official-news 채널 계약)이 들어간 head가 `a4021f0`입니다. 이보다 아래/다른 브랜치에 작업을 얹지 마세요.
- 작업 브랜치는 `feat/...` 를 만들어 거기서 작업하고 **병합은 하지 말고 Draft PR만** 유지하세요.

## 3. 지금 구현할 두 트랙 (파일 영역이 다르므로 병렬 가능)

### 트랙 F — 공식뉴스 채널 쓰기경로 수정
작업지시서: `04_개발/docs/tracks/TRACK_F_OFFICIAL_NEWS_CHANNEL_WRITE_WORK_ORDER.md`를 먼저 읽으세요.
핵심:
- `admin-v1.ts` / `admin-operational-v2.ts` 의 `createPost`/`patchPost`가 `channel`을 세팅하지 않아,
  새 글 전부가 `apartment_news`로 들어갑니다. → **쓰기 경로에 `channel` 파생 적용**.
- 단일 규칙 `deriveChannel(sourceName, explicit?)`: (1) 명시 enum 값 우선, (2)
  `SOURCE_CHANNEL = { '단지온 운영자': 'danjion_notice', '관리사무소': 'management_office' }`,
  (3) 그 외 기본 `apartment_news`. 미지 명시 값은 `400 INVALID_CHANNEL`.
- 백필(`040`)과 쓰기 경로가 **같은 상수**를 바라보게 하세요(드리프트 금지).
- `returning ... channel` 추가하여 쓰기 응답에 채널 노출.
- 새 매핑은 마이그레이션 `041`(필요시)로만 추가. `040`은 수정 금지.
- 쓰기 계약 테스트 신설: `backend/tests/complex-news-channel-write-contract.mjs` +
  `package.json`에 `test:complex-news-channel-write` 등록(해당하는 모든 places).
  반드시 다음 4항목 커버:
  (1) 명시 enum 우선, (2) 미지 enum → 400, (3) 연쇄 파생(단지온 운영자→danjion_notice, 관리사무소→management_office, 미지정→apartment_news), (4) 040과 동일 상수 공유.
- HOLD: `chair_greeting`(회장 인사말)에 소스 매핑을 임의로 추가하지 마세요. 지금은 기본값에 두고,
  CTO 허가 전에는 매핑하지 않습니다.

### 트랙 G — R1 패리티 슬라이스
작업지시서: `04_개발/docs/tracks/TRACK_G_R1_PARITY_SLICE_WORK_ORDER.md`를 먼저 읽으세요.
핵심:
- 아래 6개 화면에 **기준 대조 기반 시각·상호작용 패리티 계약 테스트**를 추가하고, 드리프트 지점만 소규모 보정.
  24 설정 / 27 알림함 / 25 1:1문의 / 28 나의활동 / 26 우리집연결 / 25A 신청제보.
- **인증·스키마·백엔드 로직·migration은 절대 건드리지 마세요.** 이 트랙은 프론트 패리티 계약 + 소규모 시각 보정입니다.
- 기존 `frontend/tests/v2-current-*-contract.mjs` 방식/스타일을 재사용하세요.

## 4. 반드시 제외(HOLD) — 구현·추론 금지
- **23 이웃온기**: 웜스 점수 공식/가중치/페널티는 소유자 결정 사항. 신규 구현 금지.
- **03 주민혜택 쿠폰 단독 (#253/#139)**: 혜택 정책 소유자 결정. 구현 금지.

## 5. 완료 게이트 (모두 통과해야 완료)
- backend: `npm run typecheck` 그린 / `test:complex-news-channel` 그린 / `test:complex-news-channel-write` 그린
- frontend: `npm run typecheck`(전체 parity) 그린 / `test:v2-complex-news-contract` 그린 / `npm run build` 그린
- 기존 `v2-current-*-contract` 6종 회귀 그린
- (트랙 G) 제외 항목(23/03)이 코드에 추가되지 않았음 확인
- PR body에 변경 파일 목록, 실행 테스트 결과, 직전 푸시 커밋 해시를 기록.

## 6. 금지 (하드 경계)
- migration 001~039 변경 금지, 040 수정 금지. production DB write/seed, production deploy, production Drive write 금지.
- secret 값을 코드/로그/issue/PR/채팅에 넣지 마세요.
- PR는 항상 **Draft** 유지, **merge 금지**, `PRODUCTION_READY` 선언 금지.

## 7. 완료 후 보고 (이 형식 그대로)
```
[완료 보고]
- 작업 브랜치: ...
- 커밋 해시: ...
- 변경 파일 목록: ...
- 실행 테스트 결과:
  backend typecheck: PASS/FAIL
  backend test:complex-news-channel: PASS/FAIL
  backend test:complex-news-channel-write: PASS/FAIL
  frontend typecheck: PASS/FAIL
  frontend test:v2-complex-news-contract: PASS/FAIL
  frontend build: PASS/FAIL
- 회귀(v2-current-*-contract 6종): PASS/FAIL
- 제외항목(23 온기/03 쿠폰) 미변경 확인: YES/NO
- 최종 판정 요청: TRACK_F_... / TRACK_G_...
```
