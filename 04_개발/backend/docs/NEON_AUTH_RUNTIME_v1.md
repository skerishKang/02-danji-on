# DanjiOn Neon Auth Runtime Contract v1

Track A / Issue #13 / Draft PR #17의 backend 인증 계약이다.

## 1. 역할 분리

Neon Auth는 **인증(authentication)** 만 담당한다.

아파트 단지 권한은 기존 DanjiOn 도메인이 계속 담당한다.

```text
Neon Auth session
  -> session access JWT
  -> backend Authorization: Bearer <jwt>
  -> JWT signature / issuer / audience / expiry 검증
  -> JWT sub
  -> app_users.auth_user_id
  -> app_users.id
  -> complex_memberships
  -> apartment role / verification authorization
```

Neon Auth의 organization/member 모델을 아파트 단지 membership으로 사용하지 않는다.

## 2. 서버 검증 방식

`src/auth-v1.ts`가 모든 private/admin endpoint의 공통 actor resolver다.

- `Authorization: Bearer <jwt>`만 backend credential로 받는다.
- `NEON_AUTH_BASE_URL`의 origin을 expected issuer와 audience로 사용한다.
- `NEON_AUTH_JWKS_URL`의 remote JWKS로 서명을 검증한다.
- `NEON_AUTH_JWKS_URL`이 없으면 `<NEON_AUTH_BASE_URL>/.well-known/jwks.json`을 사용한다.
- Managed Better Auth의 현재 서명 알고리즘인 `EdDSA`만 허용한다.
- 만료, issuer, audience, signature 검증은 `jose.jwtVerify`에 맡긴다.
- 검증된 `sub`를 canonical Neon Auth subject로 사용한다.
- 토큰에 `id`가 같이 있으면 `id === sub`도 확인한다.
- `banned=true` 토큰은 제품 actor로 연결하지 않는다.

브라우저의 Neon Auth session cookie 자체는 DanjiOn API credential로 재해석하지 않는다. Neon SDK가 session에서 발급/조회한 access JWT를 DanjiOn API의 Bearer token으로 전달한다.

## 3. app_users link / bootstrap 정책

`app_users.auth_user_id`가 제품 identity bridge의 source of truth다.

### 이미 연결된 사용자

`app_users.auth_user_id = JWT sub`인 row가 있으면 그 row의 `app_users.id`를 제품 actor id로 사용한다.

### 최초 인증 사용자

유효한 Neon Auth JWT인데 `app_users` row가 없으면 다음 row만 생성한다.

- `auth_user_id`: verified JWT `sub`
- `display_name`: JWT `name`, 없으면 `단지온 사용자`
- `avatar_url`: JWT `image`, 없으면 `NULL`

동시 최초 요청은 `ON CONFLICT (auth_user_id) DO NOTHING` 후 재조회하여 하나의 제품 사용자로 수렴한다.

### 자동 생성하지 않는 것

인증 성공만으로 아래 데이터는 절대 만들지 않는다.

- `complexes`
- `complex_memberships`
- resident verification
- manager/admin role
- production seed data

따라서 신규 인증 사용자는 `app_users`는 생길 수 있지만 단지 membership이 없으면 기존 API authorization에서 그대로 `403` 또는 빈 membership 결과를 받는다. 단지 membership/인증은 기존 별도 업무흐름으로 부여해야 한다.

## 4. Environment contract

필수 runtime 변수:

```text
DATABASE_URL=<secret Neon PostgreSQL connection string>
APP_ENV=production
NEON_AUTH_BASE_URL=https://<auth-service>/.../auth
```

선택 변수:

```text
NEON_AUTH_JWKS_URL=https://<auth-service>/.../auth/.well-known/jwks.json
```

`NEON_AUTH_JWKS_URL`을 생략하면 base URL에서 JWKS URL을 계산한다.

로컬 개발 호환 변수:

```text
APP_ENV=development
DEV_AUTH_BYPASS=true|false
```

`DEV_AUTH_BYPASS=true`일 때만 기존 `x-danjion-dev-auth-user` header를 사용할 수 있다. `APP_ENV=production`이면 공통 resolver가 dev header를 무조건 무시한다.

`.dev.vars`, 실제 `DATABASE_URL`, access token, session cookie, private key는 commit하지 않는다.

## 5. Auth error contract

| HTTP | code | 의미 |
|---|---|---|
| 401 | `AUTH_REQUIRED` | 인증 credential 없음 |
| 401 | `AUTH_INVALID` | Bearer 형식 오류, 잘못된/만료된 token, signature/issuer/audience 불일치, subject 오류 |
| 403 | `AUTH_FORBIDDEN` | 인증 사용자가 Neon Auth에서 blocked/banned 상태 |
| 503 | `AUTH_NOT_CONFIGURED` | Neon Auth verification runtime env가 설정되지 않음 |
| 500 | `AUTH_IDENTITY_LINK_FAILED` | 검증된 subject를 `app_users`에 resolve/bootstrap하지 못함 |

인증 이후 단지 권한 실패는 기존 DanjiOn 도메인 오류를 그대로 사용한다. 예: `FORBIDDEN`, `RESIDENT_VERIFICATION_REQUIRED`.

## 6. Production dev-bypass 보장

공통 resolver의 dev-header 경로는 다음 두 조건을 동시에 만족해야만 열린다.

1. `APP_ENV !== production`
2. `DEV_AUTH_BYPASS === true`

production에서는 `x-danjion-dev-auth-user`가 있어도 인증 credential로 사용되지 않는다. private/admin 라우터들은 각자 우회 코드를 가지지 않고 모두 `auth-v1.ts`의 `requireActor()`를 호출한다.

## 7. Test contract

`npm run check`는 다음을 순서대로 실행한다.

1. 전체 `src/**/*.ts` typecheck
2. 기존 API/domain static contract
3. executable Neon Auth actor test

Auth executable test는 production 데이터나 실제 사용자를 만들지 않고 로컬 Ed25519 key/JWKS와 mock SQL을 사용해 다음을 검증한다.

- production dev header 무효 + no auth `401`
- auth runtime 미설정 controlled error
- malformed/invalid token `401`
- valid token -> 기존 `app_users` actor resolve
- valid first-login token -> `app_users`만 bootstrap
- bootstrap 과정에서 `complex_memberships` 미생성
- banned token `403`
- wrong issuer token `401`

## 8. 실제 Neon 확인 상태와 남은 E2E blocker

2026-08-08 Track A 작업 시 읽기 전용 확인 결과:

- Organization: `Padiem`
- Project: `Danjion`
- production branch가 존재하고 PostgreSQL 18 / Singapore 구성이 확인됨
- `neon_auth` schema와 Managed Better Auth 테이블이 존재함
- 기존 DanjiOn production domain schema는 별도 migration 작업에서 적용 완료 상태

이번 Track A에서는 production user 생성, seed, schema 변경, Worker 배포를 하지 않는다.

따라서 실제 production Neon Auth 사용자로 발급한 access JWT를 Cloudflare Worker에 전달하는 end-to-end smoke test는 **production 사용자 생성/실배포 없이 수행하지 않는다**. 코드 수준의 cryptographic/auth-flow Gate는 unit + contract test로 검증하고, 실제 Auth URL/secrets 주입 및 deployed smoke test는 배포 트랙에서 수행한다.
