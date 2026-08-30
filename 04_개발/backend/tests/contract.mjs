import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const auth = read('src/auth-v1.ts');
const core = read('src/core-v1.ts');
const admin = read('src/admin-v1.ts');
const adminAudit = read('src/admin-audit-v1.ts');
const adminReviewContext = read('src/admin-review-context-v1.ts');
const adminVerification = read('src/admin-verification-v1.ts');
const operationalAuthz = read('src/operational-authz-v2.ts');
const residentApplication = read('src/resident-application-v1.ts');
const residentEconomy = read('src/resident-economy-v2.ts');
const residentVerification = read('src/resident-verification-v1.ts');
const benefitWallet = read('src/benefit-wallet-v1.ts');
const payloadPolicy = read('src/payload-policy.ts');
const schema = read('migrations/001_initial_schema.sql');
const adminMigration = read('migrations/002_admin_workflow.sql');
const domainConstraints = read('migrations/003_domain_constraints.sql');
const reviewHistory = read('migrations/004_application_review_history.sql');
const idempotencyMigration = read('migrations/005_application_idempotency.sql');
const benefitClaimsMigration = read('migrations/008_benefit_claims.sql');
const contract = read('docs/API_CONTRACT_v1.md');
const packageJson = read('package.json');

const privateRouters = [
  core,
  admin,
  adminAudit,
  adminReviewContext,
  adminVerification,
  residentApplication,
  residentEconomy,
  residentVerification,
  benefitWallet
];

const checks = [
  ['app routes admin audit before generic admin', app.includes('handleAdminAuditRequest') && app.indexOf('handleAdminAuditRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['app routes review context before generic admin', app.includes('handleAdminReviewContextRequest') && app.indexOf('handleAdminReviewContextRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['app routes admin before core', app.includes("startsWith('/api/v1/admin/')") && app.includes('handleAdminRequest')],
  ['app routes resident application workflow before core', app.includes('handleResidentApplicationRequest') && app.indexOf('handleResidentApplicationRequest') < app.lastIndexOf('core.fetch')],
  ['app routes resident benefit wallet before core', app.includes('handleBenefitWalletRequest') && app.indexOf('handleBenefitWalletRequest') < app.lastIndexOf('core.fetch')],
  ['app preflight allows idempotency header', app.includes('idempotency-key') && app.includes('access-control-allow-headers')],
  ['payload policy runs before route handling', app.includes('validateRequestPayload') && app.indexOf('validateRequestPayload') < app.lastIndexOf("startsWith('/api/v1/admin/')")],
  ['payload policy limits core/admin fields', payloadPolicy.includes('businessName: 80') && payloadPolicy.includes('reviewNote: 1000') && payloadPolicy.includes('body: 10000')],
  ['payload policy preserves request body with clone', payloadPolicy.includes('request.clone().text()')],
  ['active core uses narrow Neon type', core.includes('NeonQueryFunction<false, false>')],
  ['active admin uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['admin audit uses narrow Neon type', adminAudit.includes('NeonQueryFunction<false, false>')],
  ['review context uses narrow Neon type', adminReviewContext.includes('NeonQueryFunction<false, false>')],
  ['review context uses explicit PADIEM or council business-review authority', adminReviewContext.includes('requireOperationalAuthority') && adminReviewContext.includes("'business.review'") && adminReviewContext.includes("'council.business.review'")],
  ['review context exposes only aggregate verification evidence', adminReviewContext.includes('verification_evidence_count') && adminReviewContext.includes('residentVerificationStatus') && adminReviewContext.includes('verificationEvidenceCount')],
  ['review context never selects residence coordinates or evidence object key', !adminReviewContext.includes('building_code') && !adminReviewContext.includes('unit_code') && !adminReviewContext.includes('evidence_object_key')],
  ['admin audit uses explicit PADIEM or council business-review authority', adminAudit.includes('requireOperationalAuthority') && adminAudit.includes("'business.review'") && adminAudit.includes("'council.business.review'")],
  ['admin audit is complex scoped', adminAudit.includes('e.complex_id = ${operator.complexId}::uuid')],
  ['admin audit supports application filter and limit', adminAudit.includes("url.searchParams.get('applicationId')") && adminAudit.includes("url.searchParams.get('limit')")],
  ['resident verification admin is policy-hold fail closed', adminVerification.includes('RESIDENT_VERIFICATION_POLICY_HOLD') && !adminVerification.includes("role in ('manager','admin')") && !adminVerification.includes('evidence_object_key')],
  ['operational auth never trusts legacy manager/admin membership', !operationalAuthz.includes('complex_memberships') && operationalAuthz.includes('padiem_operator_grants') && operationalAuthz.includes('complex_operator_grants')],
  ['resident workflow uses narrow Neon type', residentEconomy.includes('NeonQueryFunction<false, false>')],
  ['resident resubmit is owner scoped', residentEconomy.includes('a.applicant_user_id = ${actor.id}::uuid') && residentEconomy.includes('a.applicant_user_id = ${resident.id}::uuid')],
  ['resident resubmit only accepts changes requested state', residentEconomy.includes("a.status = 'changes_requested'") && residentEconomy.includes("status = 'pending'")],
  ['resident create reads idempotency key', residentEconomy.includes("request.headers.get('idempotency-key')")],
  ['idempotency key validates format', residentEconomy.includes('validIdempotencyKey') && residentEconomy.includes('INVALID_IDEMPOTENCY_KEY')],
  ['idempotency request fingerprint uses SHA-256', residentEconomy.includes("crypto.subtle.digest('SHA-256'") && residentEconomy.includes('submission_fingerprint')],
  ['idempotency conflict rejects changed body', residentEconomy.includes('IDEMPOTENCY_KEY_REUSED') && residentEconomy.includes('different request body')],
  ['idempotency replay returns existing request', residentEconomy.includes('idempotency_replayed: true')],
  ['idempotency schema binds user and key uniquely', idempotencyMigration.includes('uq_business_application_submission_key') && idempotencyMigration.includes('applicant_user_id, submission_key')],
  ['idempotency schema binds key and fingerprint pair', idempotencyMigration.includes('chk_application_submission_pair') && idempotencyMigration.includes('submission_fingerprint')],
  ['public business list exists', core.includes('/businesses') && core.includes('business_complex_relations')],
  ['verified resident contact boundary exists', core.includes('requireVerifiedResident(request, env, sql, id, complexSlug)') && core.includes('business_contacts') && !core.includes("['manager','admin']")],
  ['benefit claim requires Household-v2 verified resident authority', residentEconomy.includes('requireVerifiedResident(request, env, sql, requestId, complexSlug)')],
  ['benefit wallet claim is one-per-user-and-benefit', benefitClaimsMigration.includes('unique (user_id, benefit_id)') && residentEconomy.includes('on conflict (user_id, benefit_id) do nothing')],
  ['benefit wallet claim codes are server issued', residentEconomy.includes("'DANJION-' || upper") && benefitClaimsMigration.includes('chk_benefit_claim_code_format')],
  ['benefit wallet supports stored to used lifecycle', benefitClaimsMigration.includes("status in ('stored','used')") && benefitWallet.includes("set status = 'used'")],
  ['benefit wallet use is owner scoped and idempotent', benefitWallet.includes('where user_id = ${actor.id}::uuid') && benefitWallet.includes("and status = 'stored'") && benefitWallet.includes('return ok(existing[0], requestId)')],
  ['live auth dependency is pinned', packageJson.includes('"jose": "6.2.4"')],
  ['live auth verifies remote Neon JWKS', auth.includes('createRemoteJWKSet') && auth.includes('jwtVerify') && auth.includes('.well-known/jwks.json')],
  ['live auth pins EdDSA issuer and audience', auth.includes("algorithms: ['EdDSA']") && auth.includes('issuer: config.issuer') && auth.includes('audience: config.audience')],
  ['live auth requires Neon subject', auth.includes('payload.sub') && auth.includes('Authenticated subject is missing')],
  ['live auth links subject through app_users', auth.includes('where auth_user_id = ${subject}') && auth.includes('insert into app_users (auth_user_id, display_name, avatar_url)')],
  ['auth bootstrap is race safe', auth.includes('on conflict (auth_user_id) do nothing') && auth.includes('return actorBySubject(sql, subject)')],
  ['auth bootstrap never creates apartment membership', !auth.includes('insert into complex_memberships') && !auth.includes('insert into complexes')],
  ['production dev bypass is disabled centrally', auth.includes("env.APP_ENV === 'production'") && auth.includes("env.DEV_AUTH_BYPASS !== 'true'")],
  ['auth has controlled missing and invalid errors', auth.includes("fail('AUTH_REQUIRED'") && auth.includes("fail('AUTH_INVALID'") && auth.includes("fail('AUTH_NOT_CONFIGURED'")],
  ['auth has controlled identity-link error', auth.includes('AUTH_IDENTITY_LINK_FAILED')],
  ['all private and admin routers use shared auth boundary', privateRouters.every((source) => source.includes("from './auth-v1'") || source.includes("from './operational-authz-v2'"))],
  ['legacy auth adapter pending boundary is removed', privateRouters.every((source) => !source.includes('AUTH_ADAPTER_PENDING'))],
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