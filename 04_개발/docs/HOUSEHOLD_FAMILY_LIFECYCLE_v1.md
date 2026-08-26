# DanjiOn Household Family Lifecycle v1

Status: design-independent backend foundation. No production migration/deploy in this change.

## Authority boundaries

```text
ACCOUNT_AUTHENTICATED
!= HOUSEHOLD_ASSOCIATED
!= VERIFIED_RESIDENT
```

A family invite associates an authenticated account with an existing household, but acceptance creates only a `pending` `member` membership. It never grants verified-resident authority while resident-verification policy is on HOLD (#59).

## Currentized endpoints

- `GET /api/v1/complexes/:complexSlug/household/units`
  - account authentication required
  - returns unit master only
  - does not expose household/invite/resident data
- `POST /api/v1/complexes/:complexSlug/household/claim`
  - opaque primary-claim token
  - SHA-256 hash lookup only
  - atomic `primary / verified` transition from the existing approved primary-claim contract

## Family lifecycle endpoints

- `GET /api/v1/complexes/:complexSlug/household`
  - minimum household/membership presentation
  - no email, phone, auth provider or verification evidence
- `POST /api/v1/complexes/:complexSlug/household/family-invites`
  - verified primary only
  - optional `expiresInHours` 1..168, default 24
  - plaintext token returned once only
  - database stores SHA-256 token hash only
- `POST /api/v1/household/family-invites/redeem`
  - authenticated account
  - creates `member / pending`
  - `residentVerified=false`
- `DELETE /api/v1/complexes/:complexSlug/household/family-invites/:inviteId`
  - verified primary only
  - revokes pending invite/token
- `DELETE /api/v1/complexes/:complexSlug/household/members/me`
  - non-primary member self-leave
  - status becomes `revoked`; resident authorization disappears immediately
- `DELETE /api/v1/complexes/:complexSlug/household/members/:membershipId`
  - verified primary may revoke non-primary member
  - cannot revoke/transfer primary through this endpoint

## Membership-history migration

Migration `016_household_membership_lifecycle_uniqueness.sql` replaces all-history unique constraints with partial uniqueness for `pending/verified` memberships. Revoked memberships remain immutable historical rows while a user may later form a new active association.

## Privacy

No family relationship labels are required. The lifecycle does not query or return email, phone, social-login provider, resident evidence object keys, or a resident roster.

## Production boundary

- migrations 009–016 are not applied to production by this change
- no production data writes
- no production deployment
- no resident verification provider/controller decision
