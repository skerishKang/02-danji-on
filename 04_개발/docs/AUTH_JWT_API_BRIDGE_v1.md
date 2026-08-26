# Danjion Better Auth JWT → Product API Bridge v1

Status: IMPLEMENTED ON STACKED AUTH BRANCH / NOT DEPLOYED
Date: 2026-08-26

## Purpose

After a user signs in through Danjion Better Auth, protected product API calls must use the same authenticated account without relying on development headers or client-supplied roles.

## Flow

```text
Kakao / Naver / Google / phone+password / email+password
        ↓
Better Auth browser session
        ↓
/api/auth/token
        ↓
short-lived JWT
        ↓
Authorization: Bearer <jwt>
        ↓
existing backend requireActor()
        ↓
public.app_users auth_user_id
        ↓
product authorization
```

## Browser bridge

`frontend/src/auth-fetch.ts` is the only new asynchronous bearer propagation helper.

It:
- obtains JWT from the Better Auth client token endpoint,
- keeps JWT only in memory,
- never persists JWT in localStorage/sessionStorage,
- caps the in-memory cache at 30 seconds,
- refreshes once after a 401 response,
- preserves the existing development auth adapter outside `VITE_AUTH_MODE=danjion`.

## Protected call sites migrated

- resident product API adapter
- admin API adapter
- resident/admin verification API adapter
- protected Google Drive storage upload/private-read/delete

Public product reads and public Drive image reads stay unauthenticated.

## Authorization boundaries

A valid account JWT proves only account authentication.

```text
ACCOUNT_AUTHENTICATED
!= PHONE_VERIFIED
!= VERIFIED_RESIDENT
!= PADIEM_OPERATOR
```

Backend resident/household and PADIEM operator checks remain authoritative. Using the admin frontend does not create an admin/operator grant.

## Failure behavior

- missing Better Auth session → no JWT → login-required error
- expired/stale JWT → protected API 401 → cache cleared → one JWT refresh/retry
- authorization failure after valid authentication remains a backend denial
- development identity never becomes a production bearer token

## Production requirements still pending

This bridge does not itself make production login live. Production still requires:

1. approved production auth DB/migration decision,
2. Better Auth secret,
3. production auth/API URLs and trusted origins,
4. Google/Kakao/Naver client credentials and callback registration,
5. production deployment and browser QA.

No production DB mutation or production deployment is performed by this change.
