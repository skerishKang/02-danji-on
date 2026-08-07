# 단지온 Pre-Infra Integration v1

## 목적

Neon / Cloudflare / R2 실계정을 연결하기 전에 주민앱, 운영관리앱, Backend 계약이 하나의 제품 흐름으로 맞물리는지 검증한다.

이 단계에서는 실제 인프라를 모방하는 것이 목적이 아니라, 나중에 인프라 구현체만 교체할 수 있도록 경계를 고정한다.

## 통합 브랜치

`feat/preinfra-integration`

포함 범위:

- 주민용 React 앱 `/`
- 운영관리 React 앱 `/admin.html`
- Worker용 Backend 코드
- PostgreSQL migrations / dev seed
- AuthProvider abstraction
- StorageAdapter abstraction
- shared local mock application/content store
- Playwright E2E
- GitHub Actions integration CI

## Adapter 경계

### Data

```text
DataAdapter
├─ MockAdapter
└─ ApiAdapter
```

### Authentication

```text
AuthProvider
├─ DevAuthProvider
└─ NeonAuthProvider (연결 대기)
```

`DevAuthProvider`는 auth subject만 공급한다. 역할/입주민 인증 여부를 클라이언트가 결정하는 구조가 아니다. API 모드에서 실제 권한 판정은 Backend membership 조회가 담당한다.

### Storage

```text
StorageAdapter
├─ MockStorageAdapter
└─ R2StorageAdapter (연결 대기)
```

현재 사업자 등록 대표 이미지는 이미지 타입/8MB 상한을 검증한 뒤 mock object key와 browser preview를 생성한다. R2 연결 시 폼은 유지하고 adapter 구현만 교체한다.

## Shared mock stores

동일 origin `localStorage`에서 주민앱과 운영관리앱이 개발용 상태를 공유한다.

### Application store

```text
주민 등록 신청
→ 내정보 pending
→ 관리자 동일 신청 조회
→ 보완 요청 또는 승인
→ 주민 보완 수정·재제출
→ pending 복귀
→ 관리자 승인
→ 주민 승인 상태
→ 신규 가게가 주민 검색에 공개
```

승인된 신청은 mock business로 materialize되어 검색·상세·혜택 노출까지 확인할 수 있다.

### Content store

```text
관리자 단지소식 작성
→ 주민 단지소식에 노출

관리자 주민혜택 작성
→ 주민 혜택 목록에 노출
→ 해당 가게 카드 active benefit에도 반영
```

이 localStorage 저장소들은 개발/E2E 전용이며 production persistence가 아니다.

## Business application workflow

Backend는 다음 경계를 갖는다.

```text
POST /api/v1/me/business-applications
GET  /api/v1/me/business-applications
GET  /api/v1/me/business-applications/:id
PATCH /api/v1/me/business-applications/:id
```

재제출 규칙:

- 본인 신청만 수정 가능
- `changes_requested` 상태만 재제출 가능
- 재제출 후 `pending`
- 다른 사용자 신청은 403
- 잘못된 상태는 409

## Review history

`004_application_review_history.sql`에서 `business_application_review_events`를 추가한다.

신청의 최신 상태는 `business_applications`에 유지하고, 상태 변경·보완 요청·승인·반려·재제출 이력은 immutable event row로 별도 보존한다.

보존 항목:

- application / complex
- actor user
- actor type (`applicant | manager | system`)
- from status / to status
- review note
- timestamp

## E2E Gate

Playwright Chromium으로 다음을 자동 검증한다.

1. 검색 → 상세 → 찜 → 인증 주민 연락처
2. 보완 요청 신청 → 주민 기존값 로드 → 수정 → 재제출 → 관리자 pending 확인
3. 주민 신규 등록 + 대표 이미지 mock upload → 관리자 승인
4. 승인된 신규 가게 → 주민 검색에서 실제 노출 + 신청 혜택 노출
5. 관리자 단지소식 작성 → 주민 단지소식 노출
6. 관리자 주민혜택 작성 → 주민 혜택 노출
7. 모바일 하단 5탭
8. 모바일 horizontal overflow 없음

## CI

`.github/workflows/preinfra-integration-ci.yml`

Backend:

- npm install
- TypeScript strict typecheck
- contract checks

Frontend:

- npm install
- TypeScript typecheck
- Vite production build
- Playwright Chromium install
- desktop/mobile E2E

현재 Pre-Infra 기준점에서 다음이 모두 PASS해야 한다.

```text
Backend CI
Frontend CI
Pre-Infra Integration CI
```

## 실 인프라 연결 후 교체 순서

1. Neon PostgreSQL migration 실행
2. DataAdapter를 `api` 모드로 전환
3. Neon Auth adapter 구현 후 `VITE_AUTH_MODE=neon`
4. Cloudflare Worker/Pages 연결
5. R2 adapter 구현 후 `VITE_STORAGE_MODE=r2`
6. mock E2E와 별도로 live integration/E2E 추가

## 후속 Pre-Infra 후보

실계정 없이 추가할 수 있는 다음 항목:

- application Idempotency-Key
- audit/review history 조회 UI
- 목록 pagination/cursor 계약
- admin 변경이력 화면
- 접근성 자동검사 확장
- URL 기반 검색/필터 state
- 오류/empty/loading 시나리오 E2E

## 보호 규칙

- `00~03` 기존 기준·설계·디자인·HTML 결과물 수정 금지
- 실계정 secret commit 금지
- mock auth subject를 role header처럼 사용 금지
- mock localStorage를 production persistence로 승격 금지
- PR #1~#3는 이력/검증 branch로 유지하고 임의 merge하지 않는다.
- PR #4도 실제 인프라 Gate 전까지 Draft 유지한다.
