import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const resident = read('src/resident-verification-v1.ts');
const admin = read('src/admin-verification-v1.ts');
const schema = read('migrations/001_initial_schema.sql');
const constraints = read('migrations/006_resident_verification_constraints.sql');
const history = read('migrations/007_resident_verification_review_history.sql');
const policy = read('../docs/RESIDENT_VERIFICATION_RUNTIME_POLICY_HOLD_20260827.md');

const checks = [
  ['resident verification route remains registered as a fail-closed seam', app.includes('handleResidentVerificationRequest')],
  ['admin verification route is registered before generic admin', app.includes('handleAdminVerificationRequest') && app.indexOf('handleAdminVerificationRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['resident verification uses narrow Neon type only for canonical account authentication', resident.includes('NeonQueryFunction<false, false>')],
  ['resident verification authenticates caller before policy hold', resident.includes('requireActor') && resident.includes('actorOrResponse instanceof Response')],
  ['resident verification self GET/POST is policy-hold fail closed', resident.includes("['GET', 'POST'].includes(request.method)") && resident.includes('RESIDENT_VERIFICATION_POLICY_HOLD') && resident.includes('503')],
  ['resident verification no longer queries legacy complex membership authority', !/\bfrom\s+complex_memberships\b/i.test(resident) && !/\bjoin\s+complex_memberships\b/i.test(resident)],
  ['resident verification no longer queries or mutates verification records', !/\bfrom\s+resident_verifications\b/i.test(resident) && !/\b(?:insert\s+into|update)\s+resident_verifications\b/i.test(resident)],
  ['resident verification discloses no evidence field while held', !resident.includes('evidence_object_key')],
  ['resident verification does not project legacy household-location columns', !/\bm\.building\b|\bm\.unit\b|membership\.building|membership\.unit/i.test(resident)],
  ['resident verification accepts no historical verification method while held', !resident.includes('management_confirmation') && !resident.includes("'document'") && !resident.includes("'manual'")],
  ['resident verification performs no pending/verified state mutation while held', !resident.includes('verification_status =') && !resident.includes('updated_membership') && !resident.includes('upserted_verification')],
  ['admin verification uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['admin verification authenticates caller before policy hold', admin.includes('requireActor') && admin.includes('actorOrResponse instanceof Response')],
  ['admin verification is policy-hold fail closed', admin.includes('RESIDENT_VERIFICATION_POLICY_HOLD') && admin.includes('503')],
  ['admin verification grants no manager/admin authority', !admin.includes("role in ('manager','admin')") && !admin.includes('requireManager')],
  ['admin verification discloses no resident evidence while held', !admin.includes('evidence_object_key') && !admin.includes('auth_user_id') && !admin.includes('verification_record_status')],
  ['admin verification performs no resident decision mutation while held', !admin.includes('updated_membership') && !admin.includes('updated_verification') && !admin.includes('set status = ${status}')],
  ['historical verification schema remains separate from auth without becoming current workflow authority', /create table if not exists resident_verifications\s*\(/i.test(schema) && schema.includes('verification_status')],
  ['historical constraints remain intact for stored legacy data', constraints.includes('uq_resident_verifications_membership') && constraints.includes('chk_resident_verification_evidence_key_length')],
  ['historical review history remains intact for audit records', history.includes('record_resident_verification_review_event') && history.includes('trg_resident_verification_review_history')],
  ['current policy explicitly separates account auth from resident verification', policy.includes('ACCOUNT_AUTHENTICATED != VERIFIED_RESIDENT')],
  ['current policy blocks self verification reads and submissions', policy.includes('SELF_VERIFICATION_GET_OR_POST -> POLICY_HOLD_DENY')],
  ['current policy forbids evidence collection and verification mutation', policy.includes('POLICY_HOLD -> NO_EVIDENCE_COLLECTION_AND_NO_VERIFICATION_MUTATION')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} verification contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} current resident-verification HOLD contract checks passed.`);
