# DanjiOn Account Consent + Product Closure v1

## Scope

This backend boundary is independent from final UI work.

### Consent

- `GET /api/v1/me/consents`
- `POST /api/v1/me/consents`
- consent history is append-only in `consent_records`
- current state is derived from the latest record per consent type
- supported types: terms, privacy, resident_rules, community_rules, marketing
- acceptance or withdrawal never implies resident verification

### Product-account closure

- `POST /api/v1/me/account/close`
- explicit confirmation string is required
- product profile becomes closed/anonymized
- active Household membership is revoked
- active PADIEM operator grants are revoked
- active resident-council/onboarding grants are revoked
- active family invite tokens created by the account are revoked
- pending family invites created through those tokens are revoked
- audit/history records are retained

## Authorization invariant

```text
AUTH_TOKEN_VALID
!= PRODUCT_ACCOUNT_ACTIVE

CONSENT_RECORDED
!= VERIFIED_RESIDENT

PRODUCT_ACCOUNT_CLOSED
=> DANJION PRODUCT AUTHORIZATION DENIED
```

`requireActor()` checks `app_users.account_status`, so a still-valid external JWT cannot recreate or reactivate a closed DanjiOn product account.

## Auth provider boundary

This version does **not** delete Better Auth / Neon managed-auth credentials, OAuth links, or provider sessions. It revokes DanjiOn product authorization immediately and returns `authProviderAccountDeleted: false` from the closure response.

Provider-account deletion/session revocation must be implemented as a separate auth integration step after the production auth provider rollout contract is finalized.

## Privacy boundary

Account closure does not make claims about statutory retention periods or irreversible deletion schedules. Immutable audit/history is preserved. User-facing product presentation is anonymized by clearing the avatar and replacing the product display name.

## Production safety

- no production migration in this PR
- no production write in this PR
- no production deploy in this PR
