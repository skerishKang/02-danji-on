# Danjion Email Verification & Password Recovery v1

Status: IMPLEMENTED IN DRAFT STACK / EMAIL RELAY NOT CONFIGURED / NOT DEPLOYED
Date: 2026-08-26

## Product decision

Direct Danjion accounts require an email address because email is the canonical account-recovery channel.

A phone number may be registered as an alternate username credential, but v1 does not send SMS OTP and does not claim phone ownership verification.

```text
ACCOUNT_AUTHENTICATED
!= EMAIL_VERIFIED (until the link is clicked)
!= PHONE_VERIFIED
!= VERIFIED_RESIDENT
!= PADIEM_OPERATOR
```

## Better Auth policy

The server now supports:

- verification email delivery on password-account sign-up,
- verification email resend,
- verified-email requirement for credential sessions by default,
- password-reset email delivery,
- one-hour verification/reset tokens,
- revocation of other sessions after password reset.

`AUTH_REQUIRE_EMAIL_VERIFICATION=false` exists only as an explicit local/sandbox escape hatch. The default posture is verification required.

The Better Auth username plugin inherits the email-verification gate, so phone-number + password login cannot create a credential session while the canonical recovery email remains unverified.

Social provider sign-in remains provider-specific. The email/password verification switch must not be misrepresented as phone, resident, or legal-identity verification.

## Transactional email boundary

Danjion does not commit a vendor-specific transactional-email SDK or secret yet.

`backend/src/auth-email-v1.ts` sends a server-to-server JSON request to a PADIEM-controlled email-relay contract:

- `AUTH_EMAIL_RELAY_URL`
- `AUTH_EMAIL_RELAY_TOKEN`
- `AUTH_EMAIL_FROM`

The relay can later be implemented with Resend, SES, Postmark, or another transactional provider without changing Better Auth or browser code.

Provider API keys remain behind the relay and never enter Vite/browser configuration.

## Browser recovery surface

`auth-recovery.html` supports three flows:

1. request a password-reset email,
2. resend an email-verification link,
3. set a new password when Better Auth redirects back with a reset token.

The same page also shows the successful email-verification landing state.

The page is `noindex,nofollow`, does not persist reset/verification tokens in browser storage, and displays a generic response for email requests so the UI does not reveal whether an account exists.

## Current deployment blocker

This code is not sufficient for live email delivery by itself. Before real deployment, an approved transactional email relay must exist and the following secrets/configuration must be supplied to the auth Worker:

```text
AUTH_EMAIL_RELAY_URL
AUTH_EMAIL_RELAY_TOKEN
AUTH_EMAIL_FROM
BETTER_AUTH_SECRET
DANJION_AUTH_BASE_URL
```

OAuth providers separately require their own client IDs/secrets and callback registration.

## Production safety

This change does not:

- migrate Neon production,
- configure a real email provider,
- send any real email,
- configure Google/Kakao/Naver credentials,
- decide resident verification,
- deploy production.
