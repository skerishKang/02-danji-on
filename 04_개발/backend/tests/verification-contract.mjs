import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const resident = read('src/resident-verification-v1.ts');
const admin = read('src/admin-verification-v1.ts');
const schema = read('migrations/001_initial_schema.sql');
const constraints = read('migrations/006_resident_verification_constraints.sql');
const history = read('migrations/007_resident_verification_review_history.sql');

const checks = [
  ['resident verification route is registered', app.includes('handleResidentVerificationRequest')],
  ['admin verification route is registered before generic admin', app.includes('handleAdminVerificationRequest') && app.indexOf('handleAdminVerificationRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['resident verification uses narrow Neon type', resident.includes('NeonQueryFunction<false, false>')],
  ['resident verification is membership scoped', resident.includes('m.user_id = ${actor.id}::uuid') && resident.includes('c.slug = ${complexSlug}')],
  ['verified resident cannot reapply', resident.includes('ALREADY_VERIFIED')],
  ['document verification requires evidence', resident.includes("method === 'document'") && resident.includes('evidenceObjectKey is required')],
  ['resident submission moves membership to pending', resident.includes("verification_status = 'pending'")],
  ['resident submission keeps verification record pending', resident.includes("set status = 'pending'") && resident.includes("'pending',\n        ${method}")],
  ['resident submission upserts one verification per membership', resident.includes('on conflict (membership_id) do update')],
  ['admin verification uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['admin verification authenticates caller before policy hold', admin.includes('requireActor') && admin.includes('actorOrResponse instanceof Response')],
  ['admin verification is policy-hold fail closed', admin.includes('RESIDENT_VERIFICATION_POLICY_HOLD') && admin.includes('503')],
  ['admin verification no longer grants manager/admin authority', !admin.includes("role in ('manager','admin')") && !admin.includes('requireManager')],
  ['admin verification discloses no resident evidence while held', !admin.includes('evidence_object_key') && !admin.includes('auth_user_id') && !admin.includes('verification_record_status')],
  ['admin verification performs no resident decision mutation while held', !admin.includes('updated_membership') && !admin.includes('updated_verification') && !admin.includes('set status = ${status}')],
  ['base schema keeps verification separate from auth', /create table if not exists resident_verifications\s*\(/i.test(schema) && schema.includes('verification_status')],
  ['verification constraints add live-api columns', constraints.includes('add column if not exists building') && constraints.includes('add column if not exists unit') && constraints.includes('add column if not exists requested_at') && constraints.includes('add column if not exists note')],
  ['resident verification has one current row per membership', constraints.includes('uq_resident_verifications_membership')],
  ['verification constraints limit unit and building', constraints.includes('chk_membership_building_length') && constraints.includes('chk_membership_unit_length')],
  ['verification method is constrained', constraints.includes('chk_resident_verification_method')],
  ['verification note and evidence key are bounded', constraints.includes('chk_resident_verification_note_length') && constraints.includes('chk_resident_verification_evidence_key_length')],
  ['verification review history trigger exists', history.includes('record_resident_verification_review_event') && history.includes('trg_resident_verification_review_history')],
  ['verification review history preserves historical applicant/manager attribution', history.includes("then 'manager'") && history.includes("then 'applicant'")]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} verification contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} verification contract checks passed.`);
