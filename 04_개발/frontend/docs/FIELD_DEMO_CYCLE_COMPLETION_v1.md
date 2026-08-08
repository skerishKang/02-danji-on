# 단지온 8월 현장시연 — Scene 08 및 전체 순환 Gate

## 1. 기준

Drive `단지온_8월현장시연_통합시제품_v1` 재현지시서의 Scene 08과 5분 재현 테스트를 제품 코드로 이식한다.

고정 엔딩 문구:

> 우리 단지의 소비가 우리 이웃의 일로 이어집니다.

고정 순환:

`발견 → 혜택 → 내 일 등록 → 운영확인 → 공개 → 다시 발견`

모든 수치·지표에는 `시연용 예시`를 명시한다.

## 2. Scene 08 제품 구현

`/ending.html`은 별도 Vite multi-page surface다.

표시 항목:
- 고정 엔딩 메시지
- 6단계 생활경제 순환
- 공개 가게·서비스 수
- 보관·사용 주민혜택 수
- 승인된 내 일 수
- 승인 후 다시 발견한 가게명
- `다시 이웃가게 보기`
- `처음부터 다시 보기`

지표는 mock/API adapter가 현재 읽은 실제 제품 상태를 사용하지만, 현장시연 화면에서는 항상 `시연용 예시`로 표시한다.

## 3. 승인 후 엔딩 연결

Scene 07 승인 후 `주민 공개목록에서 확인`으로 돌아오면 승인된 카드에 deep-link highlight가 적용된다.

해당 카드에는 `생활경제 순환 보기`를 추가한다.

`/ending.html?businessName=<name>`으로 이동하면 해당 가게가 현재 공개 business 목록에 실제 존재하는지 확인하고, 존재할 때 `승인 후 주민 공개목록에서 다시 발견됐습니다.` 상태를 표시한다.

## 4. 전체 5분 순환 Gate

`field-demo-cycle.spec.ts`는 하나의 브라우저 세션에서 다음을 순서대로 검증한다.

1. 상태 초기화
2. `반찬` 검색
3. 정다운 반찬가게 상세
4. 첫 방문 10% 할인 주민혜택 받기
5. `DANJION-0248` 내정보 보관 확인
6. 내정보에서 `새 등록 신청`
7. 한결수학 4단계 등록
8. 홍보물 3종 생성
9. 관리자 운영확인
10. 공개정보 / 비공개 확인정보 분리
11. 승인하여 공개
12. 공개 가게·서비스 수 정확히 +1
13. 주민 공개목록 재진입
14. 한결수학 강조/재발견
15. 생활경제 엔딩 진입
16. 6단계 순환 표시
17. 공개 수 / 혜택 수 / 승인 수 상태 반영
18. 모든 지표 `시연용 예시` 표기
19. Scene 08 axe WCAG serious/critical 0

## 5. 반응형 Gate

Scene 08은 다음 8개 폭에서 `scrollWidth == innerWidth`를 검증한다.

- 1440×1100
- 1280×800
- 1024×768
- 768×1024
- 430×932
- 390×844
- 360×800
- 320×720

## 6. 보호 규칙

- `00~03` 원본 수정 금지
- Neon / Cloudflare / R2 실연결 금지
- 실제 운영지표처럼 오인될 숫자 표기 금지: 엔딩 지표는 반드시 `시연용 예시`
- Scene 08에서 관리비·민원·투표·시설예약 등 비핵심 아파트 관리 기능 추가 금지
- 자동재생 소리, 스크롤 가로채기, 무거운 3D/프레임 시퀀스 금지
- PR은 Draft 상태 유지, 실인프라 Gate 전 merge 금지

## 7. 완료 기준

다음이 모두 PASS일 때 현장시연 순환 parity를 완료로 본다.

- Frontend typecheck
- Vite production build (`ending.html` 포함)
- Backend 기존 contract regression
- Resident Verification regression
- 기존 Pre-Infra E2E
- Scene 08 ending E2E
- 전체 5분 field-demo cycle E2E
- 8개 viewport overflow Gate
- axe serious/critical 0
