# Resident Economy Household v2 AuthZ

Date: 2026-08-26
Issue: #73

## Purpose

Move sensitive resident-economy mutations off the legacy `complex_memberships` authorization path and onto the canonical Household v2 verified-resident boundary.

## Authoritative boundary

Sensitive resident mutations must use:

`requireVerifiedResident(request, env, sql, requestId, complexSlug)`

This derives authority from authenticated `app_users` identity plus a verified `household_memberships` record in the requested complex. Client-supplied role, verified, complex, dong, or unit claims are not authorization inputs.

## V2 mutation routes

The app router intercepts these POST routes before legacy handlers:

- `/api/v1/me/business-applications`
- `/api/v1/me/benefits/:benefitId/claim`

Business application creation derives both applicant user ID and complex ID from the verified resident context. Benefit claiming likewise derives user and complex authority from the verified resident context and additionally requires an active benefit, approved business, matching complex, and active time window.

## Compatibility boundary

This change is intentionally narrow:

- existing applicant-owned application GET/PATCH behavior is unchanged
- existing benefit wallet list/use ownership behavior is unchanged
- legacy modules remain available for those non-migrated operations
- the V2 mutation handler runs first, so the sensitive POST routes cannot fall through to legacy membership authorization

## Privacy / resident-verification HOLD

This work does not decide how a resident becomes verified. It consumes the existing provider-neutral Household v2 authorization boundary only.

It does not:

- choose management-office approval vs household code vs another provider
- import a resident roster
- grant management-office, council, or PADIEM broad resident-data access
- alter Privacy HOLD Issue #59

Invariant:

`ACCOUNT_AUTHENTICATED != VERIFIED_RESIDENT`

## Production safety

- no new schema
- no production database migration
- no production data write
- no production deploy
- no frontend/UI change
