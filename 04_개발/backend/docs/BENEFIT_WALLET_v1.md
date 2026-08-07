# DanjiOn Resident Benefit Wallet v1

## 목적

Drive 현장시연의 주민혜택 상태를 실제 제품 계약으로 이식한다.

```text
받기 전
  ↓ 주민혜택 받기
보관 중 (stored)
  ↓ 사용 완료 처리
사용 완료 (used)
```

## 보안 경계

- 로그인만으로 혜택을 받을 수 없다.
- claim 시 현재 단지의 `complex_memberships.verification_status = verified`가 필요하다.
- 클라이언트가 `claim_code`, `user_id`, `status`를 결정하지 않는다.
- claim code는 서버가 발급한다.
- 한 사용자는 같은 benefit을 한 번만 claim할 수 있다.
- 사용 완료 처리는 자기 claim만 가능하다.
- `used → stored` 역전이는 v1에서 허용하지 않는다.

## DB

Migration: `008_benefit_claims.sql`

핵심 필드:

- `benefit_id`
- `user_id`
- `complex_id`
- `claim_code`
- `status: stored | used`
- `claimed_at`
- `used_at`

Unique:

```text
(user_id, benefit_id)
claim_code
```

## API

### `GET /api/v1/me/benefits`

현재 사용자의 받은 주민혜택 지갑을 최근 순으로 조회한다.

### `POST /api/v1/me/benefits/:benefitId/claim`

Body:

```json
{
  "complexSlug": "bangnim-myeongji-roadhill"
}
```

검사:

1. 인증 사용자
2. 대상 단지 verified membership
3. active benefit
4. approved business
5. 기간 유효

동일 `(user, benefit)` 재호출은 기존 claim을 반환한다.

### `PATCH /api/v1/me/benefits/:benefitId/use`

현재 사용자의 `stored` claim을 `used`로 바꾸고 `used_at`을 기록한다.
이미 `used`인 경우 현재 상태를 반환해 idempotent하게 처리한다.

## Mock mode

`danjion.mock.benefit-wallet.v1` localStorage를 사용한다.

현장시연 parity를 위해 `benefit-1`은 `DANJION-0248`을 사용하고, 나머지는 benefit id 기반 deterministic 4자리 코드로 만든다.

Mock persistence는 product persistence가 아니며 실제 서비스에서는 `benefit_claims`가 authoritative source다.

## UI

- 주민혜택 목록: `주민혜택 받기 / 사용 완료 처리 / 사용 완료됨`
- 상세: 현재 benefit의 claim 상태와 혜택번호
- 내정보: `받은 주민혜택` 지갑, 혜택번호, 보관/사용완료 상태

## 후속

실제 사용 확인을 사업자 측에서 처리해야 할 경우 v2에서 별도 redemption verifier/merchant action을 추가한다. v1은 현장시연과 초기 파일럿에 맞춰 주민 self-completion 상태만 제공한다.
