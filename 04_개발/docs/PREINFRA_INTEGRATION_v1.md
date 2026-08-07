# 단지온 Pre-Infra Integration v1

## 목적

Neon / Cloudflare / R2 실계정을 연결하기 전에 주민앱, 운영관리앱, Backend 계약이 하나의 제품 흐름으로 맞물리는지 검증한다.

이 단계에서는 실제 인프라를 모방하는 것이 목적이 아니라, 나중에 인프라 구현체만 교체할 수 있도록 경계를 고정한다.

## 통합 브랜치

`feat/preinfra-integration`

포함 범위:

- 주민용 React 앱 `/`
- 운영관리 React 앱 `/admin.html`
- Cloudflare Worker용 Backend 코드
- PostgreSQL migrations / dev seed
- AuthProvider abstraction
- StorageAdapter abstraction
- shared local mock application store
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

현재 사업자 등록 대표 이미지는 mock object key와 browser preview를 생성한다. R2 연결 시 폼은 유지하고 adapter 구현만 교체한다.

## Shared mock store

주민앱과 운영관리앱의 신청 데이터를 동일 origin `localStorage`에 저장한다.

따라서 실 DB 없이도 다음 흐름을 하나의 브라우저 컨텍스트에서 검증할 수 있다.

```text
주민 등록 신청
→ 내정보에서 pending 확인
→ /admin.html에서 동일 신청 조회
→ 관리자 승인
→ 주민 화면 재진입
→ approved 상태 확인
```

이 저장소는 개발/E2E 전용이며 production 데이터 저장 방식이 아니다.

## E2E Gate

Playwright Chromium으로 다음을 자동 검증한다.

1. 검색 → 상세 → 찜 → 인증 주민 연락처
2. 주민 등록신청 → 관리자 승인 → 주민 승인상태 확인
3. 관리자 단지소식 작성
4. 관리자 주민혜택 작성
5. 모바일 하단 5탭
6. 모바일 horizontal overflow 없음

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

## 실 인프라 연결 후 교체 순서

1. Neon PostgreSQL migration 실행
2. DataAdapter를 `api` 모드로 전환
3. Neon Auth adapter 구현 후 `VITE_AUTH_MODE=neon`
4. Cloudflare Worker/Pages 연결
5. R2 adapter 구현 후 `VITE_STORAGE_MODE=r2`
6. mock E2E와 별도로 live integration/E2E 추가

## 보호 규칙

- `00~03` 기존 기준·설계·디자인·HTML 결과물 수정 금지
- 실계정 secret commit 금지
- mock auth subject를 role header처럼 사용 금지
- mock localStorage를 production persistence로 승격 금지
- PR #1~#3는 이력/검증 branch로 유지하고 임의 merge하지 않는다.
