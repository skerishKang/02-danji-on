# 단지온 GitHub 기준선·백엔드 분석 v1

- 분석 기준: `main@9390b5a315c87641f94b3a53b0b94d23d31acfa7`
- 기능·정보구조 기준: `03_HTML결과물/05_실사사진중심_v5/01_단지온_v5_반응형기능기준.html`
- 작성일: 2026-08-07

## 1. 저장소 판정

현재 GitHub 기준선은 완성형 애플리케이션 소스가 아니라 제품 설계·디자인·독립형 HTML 프로토타입의 발전과정이다.

```text
00_공통기준문서   제품·브랜드·의사결정
01_설계팀         설계·운영 메모
02_디자인팀       디자인 지시·실험
03_HTML결과물     v1~v7/M1 실행 프로토타입·검증자료
99_이전문서       비활성 자료
```

`00~03`은 원본 보존영역으로 취급한다. 실제 개발코드는 `04_개발`에서 시작한다.

## 2. 기술스택 판정

기준 v5는 React/Vite/Next 앱이 아니다.

- 단일 `.html`
- inline CSS
- Vanilla JavaScript
- template string 기반 DOM 렌더링
- 브라우저 메모리 state
- JS 상수 mock data
- 실제 API 없음
- 실제 DB 없음
- 실제 Auth 없음

따라서 현재 HTML은 버릴 대상이 아니라 **UI/UX 실행명세**로 사용한다.

## 3. v5 기능 중 이미 검증된 UX

- 홈
- 검색
- 가게·서비스 목록
- 주민 관계 필터
- 분야 필터
- 관계 우선 정렬
- 상세
- 갤러리
- 문의 모달
- 찜
- 주민혜택
- 단지소식
- 내정보
- 입주민 인증 완료 화면
- 사업자 등록 단계
- 최소 관리자 화면
- 모바일 하단 메뉴
- 큰 글자 모드

반응형 QA 자료는 320/390/768/1280/1440px에서 가로 overflow 0을 기록한다.

## 4. 실제 mock data 경계

### `services`

12개 사업자/서비스가 JS 상수다.

- resident 6
- neighbor 3
- local 3

### `benefits`

4개 주민혜택이 JS 상수다.

### `notices`

5개 단지소식이 JS 상수다.

### `applications`

3개 사업자 신청이 JS 상수다.

### `state.favorites`

초기값은 `new Set([1,4])`이며 브라우저 메모리에서만 바뀐다.

### `state.registerData`

사업자 등록 단계의 임시 입력값이다. 완료 시 서버 저장 없이 성공 toast만 나온다.

## 5. 화면상 동작하지만 실제 저장되지 않는 기능

- 찜 추가/삭제
- 사업자 등록 신청
- 대표사진 업로드
- 관리자 승인/반려/보완요청
- 단지소식 작성
- 주민혜택 저장
- 연락처 공개
- 실제 전화/문자 연결
- AI 홍보물 생성

이 기능이 1차 backend 전환 대상이다.

## 6. 서버 저장 대상이 아닌 UI state

다음은 DB로 보낼 필요가 없다.

- 현재 route
- 검색 입력 중 값
- 필터 UI 열린 상태
- modal 열린 상태
- 큰 글자 preference
- reduced-motion preference

필요한 경우 URL 또는 localStorage preference로 유지한다.

## 7. 1차 데이터 모델 결정

### tenant

`complexes`

단지온은 처음부터 다중 단지 서비스로 설계한다.

### identity / authorization

- `app_users`
- `complex_memberships`
- `resident_verifications`

Neon Auth는 identity/session을 담당한다. 실제 단지 소속·role·입주민 인증상태는 제품 DB가 담당한다.

### business

- `business_categories`
- `businesses`
- `business_complex_relations`
- `business_media`
- `business_contacts`

`business_complex_relations`를 별도로 둔 이유는 같은 사업자가 A단지에서는 resident, B단지에서는 neighbor/local일 수 있기 때문이다.

### engagement / content

- `benefits`
- `bookmarks`
- `complex_posts`
- `business_applications`

## 8. 개인정보/보안 결정

공개 business/profile과 민감정보를 분리한다.

- 정확한 동·호수는 공개 business 응답 금지
- 입주민 증빙은 `resident_verifications`로 분리
- 연락처는 `business_contacts`로 분리
- 연락처 조회는 verified resident 또는 허용된 운영자만 가능
- 클라이언트의 `user_id`, `role`, `complex_id`를 권한 근거로 신뢰하지 않음
- 서버가 Auth subject → app user → membership을 확인

## 9. 백엔드 기본 구조

```text
Browser
  -> Cloudflare Pages
  -> same-origin /api
  -> Cloudflare Worker/Functions
  -> Neon PostgreSQL

Auth
  -> Neon Auth
  -> server verified subject
  -> app_users.auth_user_id
  -> complex_memberships

Images
  -> Cloudflare R2 (후속)
```

LoveBud의 Cloudflare/API 보안 패턴은 재사용하되 DanjiOn의 일반 CRUD 요청을 Modal로 우회시키지는 않는다.

## 10. 현재 구현된 backend scaffold

`feat/backend-foundation`에는 다음이 들어 있다.

- 멀티테넌트 초기 schema
- v5 기반 dev seed
- verified-resident 연락처 dev seed
- API contract
- Cloudflare Worker skeleton
- Neon HTTP driver
- request ID
- payload size 제한
- 표준 error envelope
- public business/search/detail/benefit/post read
- dev actor 기반 me/bookmark/application write
- verified-resident contact boundary
- production에서 dev auth bypass 금지

## 11. 아직 구현/검증하지 않은 것

- 실제 Neon 프로젝트에 migration 실행
- 실제 Neon Auth server adapter
- 관리자 신청 승인 transaction
- 관리자 공지/혜택 write API
- R2 업로드
- 실제 frontend app 구조
- Cloudflare Preview/Production
- live DB integration test
- browser E2E

## 12. 프론트 개발 방향

과거 v5 HTML을 직접 개조하지 않는다.

새 `04_개발/frontend`에서 v5의 화면·반응형·시각 토큰을 이식하고 API client를 분리한다.

최종 프레임워크는 production UI가 다음 요구를 갖기 때문에 component 기반 TypeScript 앱을 권장한다.

- 다수 화면/route
- 인증 상태
- role별 화면
- 등록 form state
- API loading/error state
- 관리자 화면
- 향후 M1 motion integration

1차 후보는 **Vite + React + TypeScript**다. 단, v5 시각 fidelity를 깨고 전면 재디자인하지 않는다. v5를 실행명세로 삼아 componentization한다.

## 13. 다음 개발 게이트

### Gate B1 — Backend Foundation

통과 조건:

1. schema review
2. dev seed review
3. Worker typecheck
4. Neon dev DB migration PASS
5. public read API smoke PASS
6. dev resident bookmark/application PASS
7. verified resident contact PASS
8. admin application review API 최소 구현

### Gate F1 — Frontend App Shell

B1과 병행 가능하나 DB/API 계약을 임의 변경하지 않는다.

- v5 home/list/detail 기본 이식
- API client interface
- mock adapter와 real API adapter 분리
- auth를 강제하지 않은 개발 모드

## 14. 기준선 보호 규칙

`main@9390b5a`의 `00~03` 파일은 비교·검증용 기준선이다.

- 삭제 금지
- 이름변경 금지
- 개발편의 목적 덮어쓰기 금지
- backend/frontend 개발은 `04_개발`에서 수행
