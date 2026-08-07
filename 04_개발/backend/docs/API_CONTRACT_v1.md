# DanjiOn API Contract v1

## 원칙

이 API는 v5 HTML의 mock 데이터를 실제 데이터로 치환하기 위한 1차 계약이다.

- URL의 `complexSlug`는 조회 컨텍스트를 지정한다.
- 인증이 필요한 요청에서 실제 단지/역할 권한은 서버가 auth subject → `app_users` → `complex_memberships`로 확인한다.
- 클라이언트가 보내는 `userId`, `role`, `verified` 값은 권한 근거로 사용하지 않는다.
- 공개 business 응답에는 정확한 세대정보와 비공개 연락처를 포함하지 않는다.

## 공통 응답

성공:

```json
{
  "data": {},
  "requestId": "req-..."
}
```

실패:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  },
  "requestId": "req-..."
}
```

## Public / complex-scoped read

### `GET /api/v1/complexes/:complexSlug`

현재 단지 기본정보.

### `GET /api/v1/complexes/:complexSlug/businesses`

v5 `services` 배열 대체.

Query:

- `q`: 이름/요약/카테고리 검색
- `category`: category slug 또는 `all`
- `relation`: `resident | resident_family | neighbor | local | all`
- `limit`: 기본 50, 최대 100

정렬 기본값:

1. resident
2. resident_family
3. neighbor
4. local
5. relation priority
6. 최근 승인순

### `GET /api/v1/complexes/:complexSlug/businesses/:businessId`

v5 상세화면 대체. 공개 가능한 business 본문과 media만 반환한다.

### `GET /api/v1/complexes/:complexSlug/benefits`

v5 `benefits` 배열 대체. 현재 단지에 active인 혜택만 반환한다.

### `GET /api/v1/complexes/:complexSlug/posts`

v5 `notices` 배열 대체.

Query:

- `category`
- `limit`

### `GET /api/v1/complexes/:complexSlug/posts/:postId`

공지 상세.

## Authenticated resident

### `GET /api/v1/me`

현재 사용자 profile 및 membership 요약.

### `GET /api/v1/me/bookmarks`

v5 `state.favorites` 대체.

### `POST /api/v1/me/bookmarks/:businessId`

찜 추가. idempotent.

### `DELETE /api/v1/me/bookmarks/:businessId`

찜 삭제. idempotent.

### `GET /api/v1/businesses/:businessId/contact`

연락처 공개 endpoint.

조건:

- 인증 사용자
- 해당 business가 현재 사용자 단지에 노출되는 관계인지 확인
- membership `verification_status = verified` 또는 관리자 권한

### `POST /api/v1/me/business-applications`

v5 4단계 `내 가게·서비스 등록`의 실제 저장.

Body:

```json
{
  "complexSlug": "bangnim-myeongji-roadhill",
  "relationType": "resident",
  "businessName": "정성 홈베이킹",
  "categoryName": "음식점·반찬·카페",
  "serviceSummary": "주문형 수제 쿠키와 답례품",
  "priceText": "상담 후 안내",
  "contactMethod": "phone_sms",
  "serviceArea": "방림동과 인근 지역",
  "benefitText": "첫 주문 10% 할인",
  "availabilityText": "평일 오전 10시~오후 6시",
  "representativeImageObjectKey": null
}
```

### `GET /api/v1/me/business-applications`

내 신청 상태 조회.

## Manager/Admin

### `GET /api/v1/admin/complexes/:complexSlug/business-applications`

신청 목록. manager/admin membership 필요.

### `PATCH /api/v1/admin/business-applications/:applicationId`

상태 변경:

- `changes_requested`
- `approved`
- `rejected`

승인 시 실제 `businesses` + `business_complex_relations` 생성은 동일 트랜잭션에서 처리하도록 구현한다.

### `POST /api/v1/admin/complexes/:complexSlug/posts`

단지소식 생성.

### `PATCH /api/v1/admin/posts/:postId`

단지소식 수정/보관.

### `POST /api/v1/admin/complexes/:complexSlug/benefits`

주민혜택 생성.

### `PATCH /api/v1/admin/benefits/:benefitId`

주민혜택 수정/중단.

## Storage 후속 계약

사업자 대표사진은 DB binary로 저장하지 않는다.

예정 흐름:

```text
POST /api/v1/uploads/business-image
  -> 권한 확인
  -> R2 upload URL/세션 발급
  -> upload
  -> object key를 application/business_media에 기록
```

## v5 기능 중 서버 저장 대상이 아닌 것

- 큰 글자 모드: 브라우저 preference로 유지 가능
- 화면 route/filter/query: URL/search state 또는 브라우저 state
- 모달 열림/닫힘
- M1 reduced-motion preference

## 후속 확장

- 알림센터
- 실제 문의/채팅
- 쿠폰 redemption
- AI 홍보물 생성 job
- 지도/거리 기반 검색

위 기능은 v5 핵심 영속화가 끝난 뒤 별도 migration/API로 추가한다.
