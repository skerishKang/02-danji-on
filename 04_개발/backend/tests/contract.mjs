import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const core = read('src/index.ts');
const admin = read('src/admin.ts');
const schema = read('migrations/001_initial_schema.sql');
const adminMigration = read('migrations/002_admin_workflow.sql');
const contract = read('docs/API_CONTRACT_v1.md');

const checks = [
  ['app routes admin before core', app.includes("startsWith('/api/v1/admin/')") && app.includes('handleAdminRequest')],
  ['public business list exists', core.includes('/businesses') && core.includes('business_complex_relations')],
  ['verified resident contact boundary exists', core.includes('RESIDENT_VERIFICATION_REQUIRED') && core.includes('business_contacts')],
  ['dev bypass disabled in production', core.includes("env.APP_ENV === 'production'") && admin.includes("env.APP_ENV !== 'production'")],
  ['admin list endpoint exists', admin.includes('business-applications$/') && admin.includes("request.method === 'GET'")],
  ['admin approval uses serializable transaction', admin.includes("isolationMode: 'Serializable'")],
  ['approval creates business relation', admin.includes('created_business') && admin.includes('created_relation')],
  ['approval can create benefit', admin.includes('created_benefit')],
  ['post write endpoints exist', admin.includes('createPost') && admin.includes('patchPost')],
  ['benefit write endpoints exist', admin.includes('createBenefit') && admin.includes('patchBenefit')],
  ['application link migration exists', adminMigration.includes('approved_business_id')],
  ['tenant model exists', schema.includes('business_complex_relations') && schema.includes('complex_memberships')],
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
