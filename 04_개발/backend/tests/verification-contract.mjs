import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/app.ts');
const resident = read('src/resident-verification-v1.ts');
const admin = read('src/admin-verification-v1.ts');
const schema = read('migrations/001_initial_schema.sql');
const constraints = read('migrations/006_resident_verification_constraints.sql');

const checks = [
  ['resident verification route is registered', app.includes('handleResidentVerificationRequest')],
  ['admin verification route is registered before generic admin', app.includes('handleAdminVerificationRequest') && app.indexOf('handleAdminVerificationRequest') < app.indexOf("startsWith('/api/v1/admin/')")],
  ['resident verification uses narrow Neon type', resident.includes('NeonQueryFunction<false, false>')],
  ['resident verification is membership scoped', resident.includes('m.user_id = ${actor.id}::uuid') && resident.includes('c.slug = ${complexSlug}')],
  ['verified resident cannot reapply', resident.includes('ALREADY_VERIFIED')],
  ['document verification requires evidence', resident.includes("method === 'document'") && resident.includes('evidenceObjectKey is required')],
  ['resident submission moves membership to pending', resident.includes("verification_status = 'pending'")],
  ['resident submission upserts one verification per membership', resident.includes('on conflict (membership_id) do update')],
  ['admin verification uses narrow Neon type', admin.includes('NeonQueryFunction<false, false>')],
  ['admin verification requires verified manager', admin.includes("m.role in ('manager','admin')") && admin.includes("m.verification_status = 'verified'")],
  ['admin verification is complex scoped', admin.includes('m.complex_id = ${String(manager.complex_id)}::uuid')],
  ['admin only allows verified or rejected decision', admin.includes("['verified','rejected'].includes(status)")],
  ['admin review updates membership and verification together', admin.includes('with updated_membership as') && admin.includes('updated_verification as')],
  ['base schema keeps verification separate from auth', schema.includes('create table resident_verifications') && schema.includes('verification_status')],
  ['verification constraints limit unit and building', constraints.includes('chk_membership_building_length') && constraints.includes('chk_membership_unit_length')],
  ['verification method is constrained', constraints.includes('chk_resident_verification_method')],
  ['verification note and evidence key are bounded', constraints.includes('chk_resident_verification_note_length') && constraints.includes('chk_resident_verification_evidence_key_length')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} verification contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} verification contract checks passed.`);
