# Resident Verification Runtime Policy HOLD — 2026-08-27

Related: Issue #96, Issue #59

Base: PR #95 exact accepted head `163b7c037098b241aa6c483e765ce5730461e4aa`

## Current decision

The live/API self-service resident-verification runtime is disabled while Issue #59 remains unresolved.

`ACCOUNT_AUTHENTICATED != VERIFIED_RESIDENT`

`SELF_VERIFICATION_GET_OR_POST -> POLICY_HOLD_DENY`

`LEGACY_COMPLEX_MEMBERSHIP != CURRENT_VERIFICATION_WORKFLOW`

`POLICY_HOLD -> NO_EVIDENCE_COLLECTION_AND_NO_VERIFICATION_MUTATION`

The protected endpoint remains registered only as a fail-closed seam:

`GET|POST /api/v1/me/complexes/:complexSlug/resident-verification`

A caller must first pass canonical DanjiOn account authentication. After authentication, both GET and POST return `RESIDENT_VERIFICATION_POLICY_HOLD` with HTTP 503. The route does not disclose or mutate resident-verification state.

## Historical runtime that is no longer current authority

The previous implementation used legacy `complex_memberships` and exposed or accepted:

- exact building and unit;
- legacy `verification_status`;
- `document` verification;
- `management_confirmation` verification;
- `manual` verification;
- private evidence object keys;
- verification notes and review timestamps;
- mutation of legacy membership verification status;
- upsert of `resident_verifications`.

Those database structures remain historical compatibility/audit data. Their existence does not make that workflow the current product policy.

## Why GET is also held

Returning a reduced legacy verification state would allow the old API-mode verification UI to continue presenting a provider/method workflow as if it were current. While provider, evidence, reviewer authority and data-processing rules are unresolved, a partial live response would blur the distinction between a historical screen and an approved verification process.

Therefore the API/live route is unavailable as a whole rather than manufacturing a temporary `pending`, `verified`, or `unverified` state.

## Frontend boundary

This lane does not redesign or delete sibling-owned UI. Historical mock/demo verification behavior remains available only in mock mode for regression/demo purposes. It is not evidence of an approved live resident-verification workflow.

The final UI and API flow must be connected later only after Issue #59 resolves the provider/policy/data-access decisions.

## Admin symmetry

The admin resident-verification route is already fail-closed under the same Issue #59 HOLD. This repair makes the self-service API boundary symmetric: neither residents nor operators can use the legacy runtime to advance or inspect live verification state while the policy is unresolved.

## Deliberately not decided

This repair does not select or authorize:

- a resident-verification provider;
- management-office confirmation;
- resident-council verification review;
- PADIEM verification review;
- document/evidence verification;
- a roster-import model;
- evidence retention/deletion periods;
- controller/processor/third-party provision roles.

No production migration, production database write, production deployment, Google Drive write, provider configuration or UI redesign is part of this repair.
