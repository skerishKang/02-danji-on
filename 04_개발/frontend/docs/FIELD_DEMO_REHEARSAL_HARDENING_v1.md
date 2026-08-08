# 단지온 현장시연 운영 안정화 v1

## 1. 목적

Drive 현장시연 순환이 제품 코드와 E2E로 연결된 뒤, 실제 발표 현장에서 반복 시연·새로고침·일시적 네트워크 장애 때문에 상태가 꼬이는 문제를 줄이기 위한 운영 Gate다.

이 문서는 Mock 현장시연 전용이다. Neon/Cloudflare/R2 또는 실제 운영 DB가 연결된 API 모드에서는 자동 reset을 실행하지 않는다.

## 2. 시연 콘솔

진입점: `/demo.html`

제공 기능:

1. `시연 준비 초기화`
2. `시연 시작`
3. `마지막 지점으로 복구`
4. 현재 시연 상태/시각/Run ID 표시
5. 네트워크 및 service worker 준비상태 표시
6. 마지막 오류 표시

## 3. deterministic baseline

`시연 준비 초기화`는 다음 Mock 상태만 초기화한다.

- 사업자 등록 신청 → 기준 fixture 3건
- 사업자 신청 검토이력 → 기준 fixture 상태
- 주민혜택 지갑 → 0건
- 관리자가 추가한 공지 → 0건
- 관리자가 추가한 혜택 → 0건
- 입주민 인증 → 개발 fixture 기준상태
- 대표사진/증빙 Mock IndexedDB → 비움

단지온 이외 브라우저 localStorage를 무차별 `clear()`하지 않는다.

## 4. 실제 API 보호

`VITE_DATA_MODE=api`에서는 `prepareFieldDemo()`가 실패해야 한다.

실제 운영 데이터, Neon DB, Cloudflare R2를 시연 콘솔에서 삭제하거나 reset하는 기능은 만들지 않는다.

## 5. 진행상태와 checkpoint

시연 세션은 `danjion.demo.session.v1`에 최소한의 복구정보를 기록한다.

- 상태: idle / ready / running / complete
- Run ID
- 준비/시작/완료 시각
- 마지막 surface
- 마지막 URL
- 마지막 브라우저 오류

주요 surface:

- 주민 발견·내정보
- 홍보물 3종
- 운영관리
- 운영확인·승인
- 생활경제 엔딩

`마지막 지점으로 복구`는 마지막 URL로 이동한다. 신청 ID가 query string에 있는 홍보물/운영확인 화면은 동일 신청을 다시 연다.

## 6. 새로고침 복구

Mock 제품 데이터는 localStorage/IndexedDB에 보존되므로 브라우저 새로고침 후에도 현재 신청·혜택·대표사진 상태를 읽는다.

Rehearsal E2E는 홍보물 화면에서 실제 reload 후 동일 신청이 다시 열리는 것을 검증한다.

## 7. 일시적 오프라인 대비

Mock 시연 모드에서는 `/demo-sw.js` service worker가 앱 shell을 cache한다.

사전 cache 대상:

- `/`
- `/demo.html`
- `/admin.html`
- `/operations-review.html`
- `/promo.html`
- `/ending.html`
- `/verification.html`
- `/verification-admin.html`

이미 방문한 JS/CSS/image GET 자산은 runtime cache한다.

`/api/` 요청은 service worker가 cache하거나 가로채지 않는다.

따라서 이 오프라인 대비는 **Mock 현장시연의 화면 shell 복구용**이며, 실 API 기능을 오프라인으로 동작시키는 기능이 아니다.

## 8. 완료 판정

`/demo.html`에서 시연을 시작한 세션이 `/ending.html`에 도달하면 상태를 `complete`로 기록한다.

전체 5분 E2E는 다음을 검증한다.

`시연 콘솔 초기화 → 시작 → 발견 → 상세 → 주민혜택 → 내정보 → 4단계 등록 → 홍보물 3종 → 운영확인 → 승인 공개 → 다시 발견 → 생활경제 엔딩 → session complete`

## 9. Recovery Gate

별도 rehearsal E2E는 다음을 검증한다.

- 오염된 localStorage를 기준 fixture로 초기화
- 혜택/운영콘텐츠 잔여 데이터 제거
- 주민 인증 fixture 복원
- 새로고침 후 홍보물 화면 복구
- `/demo.html`에서 마지막 홍보물 URL로 복구
- service worker가 활성화된 뒤 임시 offline 상태에서 홍보물 화면 reload
- 브라우저 오류를 세션에 기록하고 콘솔에 표시
- 콘솔 axe WCAG A/AA serious/critical 0

## 10. 금지사항

- 실제 운영 DB reset 기능 추가 금지
- `/api/` 응답 service worker cache 금지
- 실제 운영 수치를 시연 fixture처럼 덮어쓰기 금지
- `00~03` 원본 수정 금지
- Neon/Cloudflare 계정 연결 전 인프라 종속 코드 강제 금지
