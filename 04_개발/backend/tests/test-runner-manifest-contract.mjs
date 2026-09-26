/**
 * Drift guard for 04_開発/test-runner.manifest.json.
 *
 * Freezes the EXACT ordered suite so that reordering, removing, or silently
 * dropping a step fails `npm run check` until the change is deliberate. This
 * is the single authoritative order; the manifest and these lists must match.
 * ci_only steps are inventory-only and must never appear in a run scope.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const areaDir = join(here, '..', '..');
const manifestPath = join(areaDir, 'test-runner.manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const EXPECTED_BACKEND_ORDER = [
  "typecheck",
  "test:payload-policy-1017",
  "test:storage",
  "test:storage-contract",
  "test:storage-multipart-bounds",
  "test:qa-r2-storage-lane",
  "test:r2-upload-idempotency",
  "test:r2-delete-lifecycle-parity",
  "test:official-news-image-844-lifecycle",
  "test:contract",
  "test:auth",
  "test:auth-better-contract",
  "test:account-first-auth",
  "test:auth-email-recovery",
  "test:auth-delete-boundary",
  "test:signup-contact-production-binding",
  "test:production-bootstrap-safety",
  "test:production-workflow-security",
  "test:production-db-secret-bootstrap",
  "test:production-auth-readonly-diagnostic",
  "test:production-readonly-diagnostic",
  "test:production-r2-25a-readback-integrity",
  "test:central-governance-main-audit",
  "test:backup-neon-to-drive",
  "test:backup-neon-to-drive-runtime-safety",
  "test:verify-neon-backup-restore",
  "test:production-admin-principal-provision",
  "test:production-admin-principal-adopt-existing",
  "test:auth-facade-public-base",
  "test:social-provider-runtime-capability-984",
  "test:authz-v2",
  "test:db-availability-v1",
  "test:community-write-exemption-route",
  "test:authz-v2-schema",
  "test:authz-v2-migrations",
  "test:operational-authz-v2",
  "test:admin-operational-rbac",
  "test:resident-profile-label-983",
  "test:admin-auth-before-resource-lookup-975",
  "test:benefit-null-time-range-patch",
  "test:padiem-authority",
  "test:admin-authority-contract",
  "test:admin-bootstrap",
  "test:admin-bootstrap-contract",
  "test:admin-principals-contract",
  "test:admin-review-privacy-rbac",
  "test:admin-review-context-gallery",
  "test:resident-verification-policy-hold",
  "test:household-code-verification",
  "test:household-unit-association",
  "test:admin-household-codes",
  "test:admin-household-review",
  "test:admin-household-messaging",
  "test:admin-unit-master",
  "test:household-message-lifecycle",
  "test:resident-verification-exempt-household-boundary",
  "test:resident-verification-ordinary-exemption",
  "test:temporary-resident-access",
  "test:household-family-lifecycle",
  "test:account-lifecycle",
  "test:resident-economy-household-v2",
  "test:business-image-reference-integrity",
  "test:business-image-reference-delete-guard",
  "test:business-image-cross-system-atomicity",
  "test:business-application-photos",
  "test:business-application-photos-replay",
  "test:application-documents-gap5",
  "test:application-documents-phaseb",
  "test:application-documents-phaseb-runtime",
  "test:business-image-upload-pending",
  "test:business-image-background-reconciliation",
  "test:business-image-upload-idempotency",
  "test:community-c2-schema",
  "test:community-c3-resident-api",
  "test:community-1010-post-patch-engagement",
  "test:community-c4-moderation",
  "test:community-784-immediate-publish",
  "test:community-c6a-security",
  "test:complex-news-channel",
  "test:complex-news-channel-write",
  "test:business-category-benefit",
  "test:public-complex-eligibility",
  "test:core-public-route-identifiers",
  "test:safe-complex-slug-1018",
  "test:saved-shops-server",
  "test:community-replies",
  "test:community-notifications",
  "test:resident-messages",
  "test:resident-notifications",
  "test:resident-profile",
  "test:resident-news",
  "test:resident-summary",
  "test:resident-settings",
  "test:resident-blocks",
  "test:final-user-qa-recovery",
  "test:resident-activity",
  "test:resident-safety-reports",
  "test:business-share",
  "test:business-reviews",
  "test:shop-recommendations",
  "test:category-approval-fail-closed",
  "test:report-rb-schema",
  "test:report-rb-runtime",
  "test:owner-relation-resolution",
  "test:inquiries",
  "test:backend-lane-reconciliation",
  "test:security-abuse-rate-limit",
  "test:product-rate-limit-routes",
  "test:migration-gate",
  "test:migration-ledger-integrity",
  "test:banglim-complex-units-seed-058",
  "test:account-deletion-request",
  "test:community-c2-greeting-kind",
  "test:community-c2-post-category",
  "test:complex-news-article-reactions",
  "test:application-documents-review-context",
  "test:application-documents-owner-id",
  "test:deploy-provenance",
  "test:cross-platform-executable-contract",
  "test:admin-field-limit-972",
  "test:admin-review-note-limit-994",
  "test:runner-manifest-contract",
];

const EXPECTED_FRONTEND_ORDER = [
  "typecheck:tsc",
  "test:community-contract",
  "test:v2-recommendation-contract",
  "test:v2-activity-contract",
  "test:v2-my-summary-contract",
  "test:v2-business-share-contract",
  "test:v2-settings-contract",
  "test:v2-notifications-contract",
  "test:v2-messages-contract",
  "test:v2-resident-profile-safety-contract",
  "test:v2-complex-news-contract",
  "test:v2-resident-news-contract",
  "test:resident-news-operator-contract",
  "test:v2-business-reviews-contract",
  "test:v2-inquiries-contract",
  "test:v2-household-contract",
  "test:v2-account-closure-contract",
  "test:v2-community-replies-contract",
  "test:v2-auth-entry-contract",
  "test:leaf-984-social-provider-runtime-capability-contract",
  "test:v2-current-shell-contract",
  "test:v2-current-home-contract",
  "test:v2-current-shops-contract",
  "test:v2-current-complex-hub-contract",
  "test:v2-current-resident-news-contract",
  "test:v2-current-neighbor-conversation-contract",
  "test:v2-current-settings-contract",
  "test:v2-current-notifications-contract",
  "test:v2-current-inquiries-contract",
  "test:v2-current-activity-contract",
  "test:v2-current-household-contract",
  "test:v2-current-registration-contract",
  "test:v2-current-summary-contract",
  "test:v2-current-messages-contract",
  "test:v2-current-conversation-contract",
  "test:v2-current-profile-contract",
  "test:live-build-profile-contract",
  "test:stage5a-live-contract-bridge",
  "test:stage5b-saved-shops-bridge-runtime",
  "test:stage5c-reviews-bridge-runtime",
  "test:stage5d-application-report-bridge-runtime",
  "test:stage5h-report-rb-frontend-wiring",
  "test:leaf-b766-attachment-contract",
  "test:v3-persistence-wiring-contract",
  "test:stage5e-benefit-inquiry-bridge-runtime",
  "test:stage5f-gap67-wiring-contract",
  "test:stage5g-resident-review-comments-wiring-contract",
  "test:stage5h-danjion-session-runtime",
  "test:stage5i-account-session-entry",
  "test:stage5i-danjion-news-bridge-contract",
  "test:complex-news-article-reactions-bridge",
  "test:stage5i-household-claim-wiring",
  "test:stage5j-index3-account-entry",
  "test:stage5j-messages-notifications-wiring",
  "test:stage5i-report-reviewer-resolution",
  "test:stage5k-community-wiring",
  "test:stage5k-owner-relation-raw",
  "test:stage5l-greeting-wiring",
  "test:stage5m-reviewer-private-docs",
   "test:api-endpoint-registry-contract",
   "test:v2-runtime-preview-contract",
   "test:pr-review-preview-workflow",
   "test:admin-authority-role-contract",
   "test:leaf-b788-visual-syntax-integrity",
   "test:leaf-b858-notification-settings-route",
   "test:leaf-982-settings-signed-out-gate",
   "test:leaf-981-community-reply-mobile-a11y",
  "test:leaf-b976-neighbor-modal-xss",
  "test:leaf-1025-initial-document-authority",
  "test:leaf-1030-notification-toggle-authority",
  "test:leaf-1033-unsupported-notification-neutral",
  "test:leaf-1039-unloaded-reply-projection",
  "test:canonical-dialog-regression-contract",
];

const EXPECTED_CI_ONLY = [
  "resident-settings-postgres-lifecycle",
  "resident-safety-reports-postgres-lifecycle",
  "business-share-postgres-lifecycle",
  "resident-activity-postgres-lifecycle",
  "resident-notification-postgres-lifecycle",
  "resident-profile-postgres-lifecycle",
  "resident-blocks-postgres-lifecycle",
  "shop-recommendations-postgres-lifecycle",
  "inquiries-postgres-lifecycle",
  "business-reviews-postgres-lifecycle",
  "community-postgres-security",
  "business-category-benefit-postgres-lifecycle",
  "community-replies-postgres-lifecycle",
  "business-image-postgres-concurrency",
  "business-image-upload-idempotency-postgres",
  "official-news-image-postgres-concurrency",
  "business-image-resolved-lease-cleanup-postgres",
  "community-notifications-postgres-lifecycle",
  "resident-news-postgres-lifecycle",
  "resident-summary-postgres-lifecycle",
  "run-live-db-integration",
  "business-review-comments-postgres-lifecycle",
  "application-document-upload-idempotency-postgres",
  "unit-master-postgres-lifecycle",
];

const backendIds = manifest.scopes.backend.run.map((s) => s.id);
const frontendIds = manifest.scopes.frontend.run.map((s) => s.id);
const ciIds = manifest.ci_only.backend.steps.map((s) => s.id);

assert.equal(manifest.$schema, 'danjion-test-runner-manifest-v1', 'manifest $schema changed');
assert.deepEqual(backendIds, EXPECTED_BACKEND_ORDER, 'backend run order/length drifted');
assert.deepEqual(frontendIds, EXPECTED_FRONTEND_ORDER, 'frontend run order/length drifted');
assert.deepEqual(ciIds, EXPECTED_CI_ONLY, 'ci_only inventory drifted');

// bijection: ids must be unique within each scope
assert.equal(new Set(backendIds).size, backendIds.length, 'duplicate backend step id');
assert.equal(new Set(frontendIds).size, frontendIds.length, 'duplicate frontend step id');
assert.equal(new Set(ciIds).size, ciIds.length, 'duplicate ci_only id');

// ci_only is never executed under run/--scope
for (const id of ciIds) {
  assert.ok(!backendIds.includes(id), `ci_only step ${id} leaked into backend run`);
}

// public entrypoints must not be run steps (recursion guard)
assert.ok(!backendIds.includes(manifest.scopes.backend.publicScript), 'backend publicScript present in run');
assert.ok(!frontendIds.includes(manifest.scopes.frontend.publicScript), 'frontend publicScript present in run');

// every run step is a single, executable, non-migration/non-network command
for (const [scope, run] of [
  ['backend', manifest.scopes.backend.run],
  ['frontend', manifest.scopes.frontend.run],
]) {
  for (const s of run) {
    assert.ok(s.npm || s.command, `${scope} step ${s.id} is not executable`);
    const eff = s.command || `npm run ${s.npm}`;
    assert.ok(!/&&|\|\||;/.test(eff), `${scope} step ${s.id} uses shell operators: ${eff}`);
    assert.ok(!/\bpsql\b|migration:|\bcurl\b|\bwget\b|https?:\/\//i.test(eff), `${scope} step ${s.id} forbidden command: ${eff}`);
  }
}

process.stdout.write(
  `test-runner-manifest-contract: PASS backend=${backendIds.length} frontend=${frontendIds.length} ci_only=${ciIds.length}\n`,
);
