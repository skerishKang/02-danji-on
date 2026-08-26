# Resident Evidence Storage Privacy HOLD — 2026-08-27

Related: Issue #94, Issue #59

Base: PR #93 exact green head `470004d432e415b1eb8a255a3779b905645c439a`

## Current authority

This document is a current privacy overlay for the historical Google Drive storage implementation. It does not rewrite the historical Track C record; it narrows the active resident-evidence authorization boundary while Issue #59 remains open.

The private object namespace remains:

`gdrive/private/resident-evidence/<google-file-id>`

The Drive object remains private and is served only through the DanjiOn backend.

## Current resident-evidence rule

`RESIDENT_EVIDENCE_NON_UPLOADER -> POLICY_HOLD_DENY`

`LEGACY_MANAGER_ADMIN != RESIDENT_EVIDENCE_AUTHORITY`

`PADIEM_OR_COUNCIL_OPERATIONAL_SCOPE != RESIDENT_EVIDENCE_ACCESS`

`UPLOADER_SELF_ACCESS != VERIFIED_RESIDENT_STATUS`

The authenticated uploader may read or delete/trash the evidence object they uploaded because uploader identity is recorded in the object's server-controlled Drive `appProperties`.

Every authenticated non-uploader is denied resident-evidence original access while Issue #59 remains HOLD. This includes, without creating an exhaustive legal-role conclusion:

- historical `complex_memberships manager/admin` actors;
- PADIEM operators;
- resident-council operators;
- management-office/onboarding support actors;
- other residents.

No operational scope is silently converted into resident-verification evidence authority.

The server response for a non-uploader private resident-evidence object is fail-closed with `RESIDENT_VERIFICATION_POLICY_HOLD`. This is a product privacy gate, not a final legal conclusion about future authorized evidence reviewers.

## Preserved protections

- canonical account authentication remains required for private storage operations;
- Drive ACL is not opened publicly;
- no `permissions.create(anyone)` path is introduced;
- no `webViewLink` or `webContentLink` is exposed;
- resident-evidence filenames remain opaque rather than resident/unit-derived;
- private reads remain `Cache-Control: private, no-store`;
- object metadata must continue to match the configured private folder and DanjiOn `appProperties`;
- delete continues to trash the Drive object rather than asserting a legal hard-deletion policy.

## Deliberately not decided

This repair does not decide:

- the resident-verification provider;
- who may review evidence after Issue #59 is resolved;
- controller / processor / third-party provision classification;
- evidence retention or deletion periods;
- resident roster import;
- PADIEM or resident-council broad PII access;
- management-office evidence access.

## Bounded implementation note

The historical `membershipFor()` helper remains in `storage-v1.ts` for upload/other historical storage behavior that is outside Issue #94. Its existence must not be interpreted as resident-evidence authority. The resident-evidence HOLD branch executes before any legacy manager/admin fallback in object authorization.

No production Google Drive write, production database write, production deployment, or UI change is part of this privacy repair.
