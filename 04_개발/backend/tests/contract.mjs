import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const core = read('src/core-v1.ts');
const admin = read('src/admin-v1.ts');
const adminAudit = read('src/admin-audit-v1.ts');
const residentApplication = read('src/resident-application-v1.ts');
const payloadPolicy = read('src/payload-policy.ts');
const schema = read('migrations/001_initial_schema.sql');
const adminMigration = read('migrations/002_admin_workflow.sql');
const domainConstraints = read('migrations/003_domain_constraints.sql');
const reviewHistory = read('migrations/004_application_review_history.sql');
const idempotencyMigration = read('migrations/005_application_idempotency.sql');
const contract = read('docs/API_CONTRACT_v1.md');

const checks = [
  ['app routes admin audit before generic admin', app.includes('handleAdminAuditRequest') && app.indexOf('handleAdminAuditRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['app routes admin before core', app.includes("startsWith('/api/v1/admin/')") && app.includes('handleAdminRequest')],
  ['app routes resident application workflow before core', app.includes('handleResidentApplicationRequest') && app.indexOf('handleResidentApplicationRequest') < app.lastIndexOf('core.fetch')],
  ['app preflight allows idempotency header', app.includes('idempotency-key') && app.includes('access-control-allow-headers')],
  ['payload policy runs before route handling', app.includes('validateRequestPayload') && app.indexOf('validateRequestPayload') < app.lastIndexOf("startsWith('/api/v1/admin/')")],
  ['payload policy limits core/admin fields', payloadPolicy.includes('businessName: 80') && payloadPolicy.includes('reviewNote: 1000') && payloadPolicy.includes('body: 10000')],
  ['payload policy preserves request body with clone', payloadPolicy.includes('request.clone().text()')],
  ['active core uses narrow Neon type', core.includes('NeonQueryFunction<false, false>')],
  ['active admin uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['admin audit uses narrow Neon type', adminAudit.includes('NeonQueryFunction<false, false>')],
  ['admin audit requires verified manager membership', adminAudit.includes("m.role in ('manager','admin')") && adminAudit.includes("m.verification_status = 'verified'")],
  ['admin audit is complex scoped', adminAudit.includes('e.complex_id = ${String(manager.complex_id)}::uuid')],
  ['admin audit supports application filter and limit', adminAudit.includes("url.searchParams.get('applicationId')") && adminAudit.includes("url.searchParams.get('limit')")],
  ['resident workflow uses narrow Neon type', residentApplication.includes('NeonQueryFunction<false, false>')],
  ['resident resubmit is owner scoped', residentApplication.includes('a.applicant_user_id = ${actor.id}::uuid')],
  ['resident resubmit only accepts changes requested state', residentApplication.includes("a.status = 'changes_requested'") && residentApplication.includes("status = 'pending'")],
  ['resident create reads idempotency key', residentApplication.includes("request.headers.get('idempotency-key')")],
  ['idempotency key validates format', residentApplication.includes('validIdempotencyKey') && residentApplication.includes('INVALID_IDEMPOTENCY_KEY')],
  ['idempotency request fingerprint uses SHA-256', residentApplication.includes("crypto.subtle.digest('SHA-256'") && residentApplication.includes('submission_fingerprint')],
  ['idempotency conflict rejects changed body', residentApplication.includes('IDEMPOTENCY_KEY_REUSED') && residentApplication.includes('different request body')],
  ['idempotency replay returns existing request', residentApplication.includes('idempotency_replayed: true')],
  ['idempotency schema binds user and key uniquely', idempotencyMigration.includes('uq_business_application_submission_key') && idempotencyMigration.includes('applicant_user_id, submission_key')],
  ['idempotency schema binds key and fingerprint pair', idempotencyMigration.includes('chk_application_submission_pair') && idempotencyMigration.includes('submission_fingerprint')],
  ['public business list exists', core.includes('/businesses') && core.includes('business_complex_relations')],
  ['verified resident contact boundary exists', core.includes('RESIDENT_VERIFICATION_REQUIRED') && core.includes('business_contacts')],
  ['dev bypass disabled in production', core.includes("env.APP_ENV === 'production'") && admin.includes("env.APP_ENV !== 'production'") && adminAudit.includes("env.APP_ENV !== 'production'") && residentApplication.includes("env.APP_ENV !== 'production'")],
  ['admin list endpoint exists', admin.includes('business-applications$/') && admin.includes("request.method === 'GET'")],
  ['admin approval uses atomic update gate', admin.includes('with approved as') && admin.includes("a.status in ('pending','changes_requested')")],
  ['approval creates business relation', admin.includes('created_business') && admin.includes('created_relation')],
  ['approval can create benefit', admin.includes('created_benefit')],
  ['post write endpoints exist', admin.includes('createPost') && admin.includes('patchPost')],
  ['benefit write endpoints exist', admin.includes('createBenefit') && admin.includes('patchBenefit')],
  ['application link migration exists', adminMigration.includes('approved_business_id')],
  ['tenant model exists', schema.includes('business_complex_relations') && schema.includes('complex_memberships')],
  ['domain length constraints exist', domainConstraints.includes('chk_application_business_name_length') && domainConstraints.includes('chk_post_body_length') && domainConstraints.includes('chk_benefit_title_length')],
  ['application active lookup is non-unique', domainConstraints.includes('CREATE INDEX IF NOT EXISTS idx_application_active_lookup') && !domainConstraints.includes('uq_active_application_name_per_user_complex')],
  ['exact duplicate contacts are blocked', domainConstraints.includes('uq_business_contact_exact')],
  ['application review history is immutable event data', reviewHistory.includes('business_application_review_events') && reviewHistory.includes('trg_business_application_review_history') && reviewHistory.includes('from_status') && reviewHistory.includes('to_status')],
  ['review history actor distinguishes applicant and manager', reviewHistory.includes("actor_type in ('applicant','manager','system')") && reviewHistory.includes("when new.reviewed_by is not null then 'manager'")],
  ['api contract documents resident resubmit', contract.includes('PATCH /api/v1/me/business-applications/:applicationId') && contract.includes('changes_requested')],
  ['api contract documents admin routes', contract.includes('PATCH /api/v1/admin/business-applications/:applicationId')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
}
if (failed.length) {
  console.error(`\n${failed.length} contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} contract checks passed.`);
