# DANJION Account Auth — Five Methods v1

Status: CURRENT ACCOUNT UX CONTRACT / provider wiring pending
Date: 2026-08-26

## 1. Goal

One Danjion user account may be entered through any of five login methods:

1. Kakao
2. Naver
3. Google
4. Phone number + password
5. Email + password

All methods must resolve to one canonical internal `user_id`; they are login credentials, not separate residents.

## 2. Recovery and verification

- Email is the canonical recovery channel for password reset.
- Phone number may be used as a login identifier with a password.
- SMS OTP is not a v1 requirement and must not be simulated.
- Until a real phone verification path is added, a stored phone number must not be represented as proof of number ownership.
- Future Kakao-provided phone-number matching may be evaluated as a separate verification signal, but is not resident verification or legal identity verification.

## 3. Social account linking

Kakao, Naver, and Google are attachable credentials for the same Danjion account.

Rules:
- Prefer explicit account linking while the user is authenticated.
- Do not merge accounts solely because two providers return the same email unless the merge policy is explicitly approved and safely verified.
- Provider credentials/tokens must never become resident authority.

## 4. Hard boundary

These concepts are separate:

`ACCOUNT_AUTHENTICATED != PHONE_VERIFIED != VERIFIED_RESIDENT != PADIEM_OPERATOR`

Logging in through Kakao/Naver/Google/email/phone does not prove apartment residency.

Dong/unit entry is onboarding data only until a resident-verification provider succeeds.

## 5. Resident verification

Resident verification remains a separate HOLD decision. Candidate providers include:

- management-office approval
- household one-time code
- hybrid approval + code
- future external/public verification provider

See GitHub Issue #59 for the privacy/governance decision gate.

## 6. Implementation boundary for this branch

This branch only aligns the React UI and tests with the five-method account contract.

Not implemented here:
- real OAuth callbacks
- Better Auth/Neon Auth server wiring
- provider secrets
- email delivery
- password reset backend
- phone verification
- resident verification mutation
- production DB changes
- production deployment

## 7. Backend direction

The account layer should expose a provider-adapter boundary so that authentication implementation can evolve without changing resident-verification or authorization contracts.

Target conceptual mapping:

```text
Kakao ─┐
Naver ─┤
Google ┤
Phone ─┤──> canonical account user_id
Email ─┘
             |
             +--> resident verification (separate)
             +--> household membership (separate)
             +--> PADIEM operator authorization (separate)
```

Neon remains the database target. The exact managed-Neon-Auth vs Better-Auth deployment shape must be confirmed against the provider requirements before production wiring, especially for Naver/Kakao and password-based phone login.
