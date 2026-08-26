# DanjiOn Gate1 account UI live binding v1

Status: IMPLEMENTED IN DRAFT STACK
Date: 2026-08-26

## Purpose

Bind the owner-approved five account entry methods to the Better Auth client while preserving the sibling Gate1 visual direction and keeping resident verification separate.

## Supported account entry methods

1. Kakao OAuth
2. Naver OAuth
3. Google OAuth
4. Phone number + password
5. Email + password

All five methods resolve to one DanjiOn account identity. They are not resident identities.

## Direct signup contract

- Recovery email is required for account creation.
- A phone-first signup requires both recovery email and phone number.
- An email-first signup may also register a phone number as an alternate username credential.
- Phone credential is normalized to digits such as `01012345678`.
- No SMS OTP is sent in v1.
- Registering a phone credential does not mean phone ownership has been verified.

## Login contract

- Existing users may sign in with email + password.
- Existing users with a registered phone username may sign in with phone + password.
- Social providers use Better Auth social sign-in and may create/link the account according to provider/account-linking policy.

## Runtime switch

`VITE_AUTH_MODE=danjion` enables real Better Auth calls.

The default development mode remains `dev` so visual/e2e preview work does not silently mutate an auth database or require provider credentials.

## Required runtime configuration

Frontend public configuration:

- `VITE_AUTH_MODE=danjion`
- `VITE_AUTH_BASE_URL=<Danjion auth Worker origin>`

Backend secrets/configuration are kept outside the frontend:

- `BETTER_AUTH_SECRET`
- `DANJION_AUTH_BASE_URL`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `KAKAO_CLIENT_ID` / `KAKAO_CLIENT_SECRET`
- `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`

No provider secret is committed to Git.

## Hard authorization boundary

```text
ACCOUNT_AUTHENTICATED
!= PHONE_VERIFIED
!= VERIFIED_RESIDENT
!= PADIEM_OPERATOR
```

The account UI may collect dong/unit later in the onboarding presentation, but that input must never create resident authorization by itself.

Resident verification remains under the separate privacy/governance decision gate and may later use management-office approval, household codes, or another provider.

## Database safety

The Better Auth foundation migration was validated on Neon child branch `br-weathered-violet-azkk0aiz` only.

This UI binding does not apply migration 014 to production and does not deploy an auth Worker.
