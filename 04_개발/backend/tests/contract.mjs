import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const core = read('src/core-v1.ts');
const admin = read('src/admin-v1.ts');
const schema = read('migrations/001_initial_schema.sql');
const adminMigration = read('migrations/002_admin_workflow.sql');
const domainConstraints = read('migrations/003_domain_constraints.sql');
const contract = read('docs/API_CONTRACT_v1.md');

const checks = [
  ['app routes admin before core', app.includes("startsWith('/api/v1/admin/')") && app.includes('handleAdminRequest')],
  ['active core uses narrow Neon type', core.includes('NeonQueryFunction<false, false>')],
  ['active admin uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['public business list exists', core.includes('/businesses') && core.includes('business_complex_relations')],
  ['verified resident contact boundary exists', core.includes('RESIDENT_VERIFICATION_REQUIRED') && core.includes('business_contacts')],
  ['dev bypass disabled in production', core.includes("env.APP_ENV === 'production'") && admin.includes("env.APP_ENV !== 'production'")],
  ['admin list endpoint exists', admin.includes('business-applications$/') && admin.includes("request.method === 'GET'")],
  ['admin approval uses atomic update gate', admin.includes('with approved as') && admin.includes("a.status in ('pending','changes_requested')")],
  ['approval creates business relation', admin.includes('created_business') && admin.includes('created_relation')],
  ['approval can create benefit', admin.includes('created_benefit')],
  ['post write endpoints exist', admin.includes('createPost') && admin.includes('patchPost')],
  ['benefit write endpoints exist', admin.includes('createBenefit') && admin.includes('patchBenefit')],
  ['application link migration exists', adminMigration.includes('approved_business_id')],
  ['tenant model exists', schema.includes('business_complex_relations') && schema.includes('complex_memberships')],
  ['domain length constraints exist', domainConstraints.includes('chk_application_business_name_length') && domainConstraints.includes('chk_post_body_length') && domainConstraints.includes('chk_benefit_title_length')],
  ['application idempotency lookup is non-unique', domainConstraints.includes('CREATE INDEX IF NOT EXISTS idx_application_active_lookup') && !domainConstraints.includes('uq_active_application_name_per_user_complex')],
  ['exact duplicate contacts are blocked', domainConstraints.includes('uq_business_contact_exact')],
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
