# Business Application Idempotency v1

## 대상

`POST /api/v1/me/business-applications`

## Header

```http
Idempotency-Key: application:550e8400-e29b-41d4-a716-446655440000
```

허용 형식:

- 8~80자
- 영문자 / 숫자 / `.` / `_` / `:` / `-`

Header가 없으면 기존 호환성을 위해 일반 신규 신청으로 처리한다.

## 서버 저장

`005_application_idempotency.sql`

```text
business_applications
├─ submission_key
└─ submission_fingerprint
```

Unique scope:

```text
(applicant_user_id, submission_key)
```

따라서 서로 다른 사용자는 같은 문자열 키를 사용해도 충돌하지 않는다.

## Fingerprint

서버는 정규화된 신청 payload를 고정된 property 순서로 JSON 직렬화하고 SHA-256 fingerprint를 계산한다.

포함 필드:

- complexSlug
- relationType
- businessName
- categoryName
- serviceSummary
- priceText
- contactMethod
- serviceArea
- benefitText
- availabilityText
- representativeImageObjectKey

## 서버 동작

### 첫 요청

- row 생성
- HTTP 201
- `idempotency_replayed: false`

### 같은 사용자 + 같은 key + 같은 payload

- 신규 row를 만들지 않음
- 기존 신청 반환
- HTTP 200
- `idempotency_replayed: true`

### 같은 사용자 + 같은 key + 다른 payload

- HTTP 409
- `IDEMPOTENCY_KEY_REUSED`

동일 key를 다른 의미의 요청에 재사용하는 것을 허용하지 않는다.

## Client 구현

API mode frontend는 logical submission 시작 시 다음 형식의 key를 한 번 생성한다.

```text
application:<crypto.randomUUID()>
```

`src/api/idempotency.ts`:

- `createApplicationIdempotencyKey()`
- `retryNetworkOnce()`

등록 API 호출은 첫 요청과 재시도에서 **동일한 body + 동일한 Idempotency-Key**를 사용한다.

자동 재시도 대상은 브라우저 `fetch`가 `TypeError`로 실패하는 네트워크 계층 오류 1회뿐이다.

- HTTP 4xx/5xx는 자동 재시도하지 않음
- 새로운 버튼 클릭/새 logical submission은 새로운 key 생성
- UI 자체는 `busy` 상태로 이중 클릭도 별도 차단

## 목적

다음 상황에서 중복 신청 생성을 막는다.

```text
클라이언트 key K 생성
→ 서버는 신청 저장 성공
→ 응답 전 네트워크 단절
→ 클라이언트는 실패로 인식
→ 같은 key K + 같은 body로 1회 재전송
→ 서버가 기존 신청을 반환
```

UI 이중 클릭 방지와 서버 Idempotency는 서로 다른 방어선이며 둘 다 유지한다.
