# Community C5 Product Shell — CURRENT 2026-08-30

Issue: #45

## Scope

The CURRENT Gate1 Product Shell keeps its existing visual structure while replacing resident Community local React state with the existing first-party Community API in API data mode.

- Official content remains `complex_posts` through the existing public `/api/v1/complexes/:slug/posts` boundary.
- Resident Community feed, posts, comments, reactions, and reports use `/api/v1/complexes/:slug/community/*`.
- Household-v2 `requireVerifiedResident` remains the server authority for resident access.
- Client text screening is UX assistance only. Server publication status is authoritative.
- Official posts are read-only inside the resident Community surface.
- React renders title/body/comment text without HTML injection APIs.

## C5 acceptance

- current `V2CommunityView` consumes official + resident API sources without merging their authority boundaries
- create post/comment, like/unlike, report mutations use the resident Community API
- 401/403 keeps the surface locked
- successful resident feed can promote the visible verified-resident badge
- mock mode remains available for existing deterministic frontend E2E
- `tests/community-current-integration-contract.mjs` prevents silent fallback to local-only API-mode state

C6 synthetic principal / live persistence evidence remains a separate release gate under Issue #45.
