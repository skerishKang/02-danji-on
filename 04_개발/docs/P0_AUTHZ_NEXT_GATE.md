# P0 AuthZ Next Gate

Close Issue #48 only if the exact branch head passes:

- Backend CI
  - TypeScript
  - auth-v1 tests
  - authorization-v2 principal tests
  - schema separation contract
  - migration runner contract
  - existing storage/contract/preview safety checks
- Pre-Infra Integration CI
- Resident Verification CI

Deployment workflows may remain skipped because this branch does not authorize production deployment.

Required verdict:

`P0_AUTHZ_READY_FOR_COMMUNITY_C2`

Otherwise:

`P0_AUTHZ_BLOCKED`
