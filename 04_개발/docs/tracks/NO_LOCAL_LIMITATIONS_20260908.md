# NO-LOCAL LIMITATIONS — 2026-09-08

This session used GitHub-only operations.

## Reliable in this mode

- Repository state inspection.
- PR metadata updates.
- PR review submission.
- Draft/ready state changes.
- Docs-only branch and PR creation.
- Docs-only merge when repository policy permits.

## Not reliable in this mode

- Editing complex HTML safely across many files.
- Running local static parse checks.
- Browser smoke testing at 390×844.
- Verifying runtime route behavior.
- Running npm/wrangler checks.
- Validating production deployment.

## Resulting decision

PR #276 was blocked and documented rather than edited directly, because its repair requires local or CI validation.