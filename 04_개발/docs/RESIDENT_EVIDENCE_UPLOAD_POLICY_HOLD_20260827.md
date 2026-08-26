# Resident Evidence Upload Policy HOLD — 2026-08-27

Status: **CURRENT / POLICY HOLD ENFORCEMENT**

Related: Issue #59, Issue #94, Issue #96, Issue #98

## Purpose

Issue #59 has not selected or approved a resident-verification provider, evidence collection method, review actor, retention period, or legal processing structure. The live self-verification runtime is already fail-closed, and non-uploader access to historical resident evidence is already fail-closed.

The remaining generic-storage path must not become an alternate way to collect new resident-verification evidence while that policy is unresolved.

## Current invariant

```text
ISSUE_59_OPEN -> NEW_RESIDENT_EVIDENCE_PERSISTENCE_DENY

ACCOUNT_AUTHENTICATED != RESIDENT_VERIFICATION_AUTHORIZED

BUSINESS_IMAGE_UPLOAD != RESIDENT_EVIDENCE_UPLOAD

PREEXISTING_UPLOADER_SELF_ACCESS != NEW_EVIDENCE_COLLECTION_AUTHORITY
```

## Live storage behavior while held

### New resident evidence

For authenticated `POST /api/v1/storage/objects` requests whose multipart `kind` is `resident-evidence`:

- return HTTP 503
- error code: `RESIDENT_VERIFICATION_POLICY_HOLD`
- do not consult legacy apartment membership as evidence-collection authority
- do not call the Google Drive upload helper
- do not create a new Drive resident-evidence object
- do not create a new object key

The multipart request may be parsed by the Worker to identify the server-controlled storage kind, but no resident-evidence binary or metadata is persisted.

### Business images

`kind=business-image` keeps the existing authenticated storage flow and validation rules. This HOLD does not change public business-media storage semantics.

### Historical resident evidence

This HOLD does not delete or rewrite historical objects. Existing uploader self read/delete remains available through the current object-authorization boundary so a resident is not prevented from retrieving or removing their own previously stored evidence.

Every non-uploader resident-evidence read/delete remains fail-closed under the separate current privacy boundary from Issue #94.

## Explicit non-decisions

This enforcement does **not** decide:

- document verification vs management-office confirmation vs another provider
- whether resident evidence should be collected at all
- evidence retention or destruction periods
- PADIEM, resident council, management office, or another party as evidence reviewer
- legal controller/processor/third-party provision structure
- a future evidence storage provider

Those remain Issue #59 decisions.

## Safety boundary

No production Google Drive write is required to validate this change. The contract is tested through code ordering and existing CI; a live resident-evidence upload smoke would contradict the policy HOLD.

No database migration, production DB mutation, frontend/UI redesign, Cloudflare production deploy, or merge belongs to this bounded repair.

## Required acceptance

```text
AUTHENTICATION < RESIDENT_EVIDENCE_POLICY_HOLD < LEGACY_MEMBERSHIP_LOOKUP < DRIVE_UPLOAD
```

The ordering statement applies to the resident-evidence request path: execution returns at the HOLD point, so the later membership and Drive stages are unreachable for that kind.

Final verdict when exact-head gates are green:

`NEW_RESIDENT_EVIDENCE_PERSISTENCE_POLICY_HOLD_ENFORCED`
