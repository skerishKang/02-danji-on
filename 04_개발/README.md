# 단지온 개발영역

## 기준

- 기준 커밋: `9390b5a315c87641f94b3a53b0b94d23d31acfa7`
- 기능·정보구조 기준: `03_HTML결과물/05_실사사진중심_v5/01_단지온_v5_반응형기능기준.html`
- `00_공통기준문서`, `01_설계팀`, `02_디자인팀`, `03_HTML결과물`은 제품 의사결정·디자인·프로토타입 발전 이력이다.
- 기존 HTML 원본은 개발 편의를 이유로 수정·삭제·이동하지 않는다.

## 실제 코드 판정

현재 v5는 별도 React/Vite/Next 프로젝트가 아니라 단일 HTML 내부의 CSS + Vanilla JavaScript 프로토타입이다.

브라우저 메모리의 mock 경계:

- `services`: 가게·서비스 목록과 상세
- `benefits`: 주민혜택
- `notices`: 단지소식
- `applications`: 사업자 등록 신청
- `state.favorites`: 찜 상태
- `state.registerData`: 등록 단계 중 임시 입력값

현재 다음 동작은 실제 영속 저장이 아니다.

- 찜 추가·삭제
- 사업자 등록 신청 완료
- 사업자 신청 승인/반려/보완요청
- 단지소식 저장
- 주민혜택 저장
- 대표사진 업로드
- 연락처 공개/문자 연결
- AI 홍보물 생성

## 1차 개발 목표

기존 v5 UX를 유지하면서 mock 경계를 실제 API/DB로 교체한다.

1. 가게·서비스 검색/목록/상세
2. 단지별 관계 우선 정렬
3. 주민혜택
4. 단지소식
5. 찜
6. 내정보/단지 membership
7. 사업자 등록 신청
8. 관리자 신청 검토
9. 인증 입주민에 한한 연락처 조회

## 기술 방향

```text
Browser
  -> Cloudflare Pages
  -> same-origin /api
  -> Cloudflare Worker/Functions
  -> Neon PostgreSQL

Authentication
  -> Neon Auth (adapter boundary; 실제 프로젝트 생성 후 연결)

Images
  -> Cloudflare R2 (후속 단계)
```

초기 DB 연결은 `@neondatabase/serverless`를 사용하되, 운영 트래픽과 비용/지연을 확인한 뒤 Cloudflare Hyperdrive로 교체할 수 있도록 DB 접근을 분리한다.

## 보안 경계

- 요청 본문의 `user_id`, `complex_id`, `role`을 권한 근거로 신뢰하지 않는다.
- 인증 사용자는 서버에서 auth subject를 얻고 DB membership을 조회해 단지/역할을 결정한다.
- 다른 단지의 비공개 데이터는 서버 query scope에서 차단한다.
- 정확한 동·호수, 입주민 확인자료, 인증 원본은 공개 business/profile 응답에 포함하지 않는다.
- 연락처는 `verified` 입주민 및 허용된 운영자에게만 별도 endpoint로 반환한다.
- 개발용 auth bypass는 production에서 비활성화한다.

## 개발 순서

- Phase A: schema + API contract + Worker skeleton
- Phase B: v5 mock data를 dev seed로 이전
- Phase C: public read API 연결
- Phase D: dev actor로 bookmark/application/admin write 연결
- Phase E: Neon Auth 연결
- Phase F: R2 이미지 업로드
- Phase G: Cloudflare Preview/Production 배포 및 E2E
