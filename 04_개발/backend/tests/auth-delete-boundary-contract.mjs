import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const auth = read('src/auth-better-v1.ts');
const email = read('src/auth-email-v1.ts');
const authSchema = read('src/auth-better-schema.ts');
const authMigration = read('migrations/014_danjion_better_auth.sql');
const accountMigration = read('migrations/017_account_lifecycle.sql');
const accountLifecycle = read('src/account-lifecycle-v1.ts');

const checks = [
  ['Better Auth user deletion is explicitly enabled', auth.includes('deleteUser: {') && auth.includes('enabled: true')],
  ['auth hard delete is gated by closed product account', auth.includes('requireClosedProductAccount') && auth.includes("String(row.account_status) !== 'closed'")],
  ['delete gate resolves product identity by Better Auth subject', auth.includes('where auth_user_id = ${authUserId}')],
  ['active or missing product account fails closed', auth.includes("new APIError('FORBIDDEN'") && auth.includes('product account must be closed')],
  ['delete-account verification email uses existing relay', auth.includes("kind: 'delete-account'") && auth.includes('sendDeleteAccountVerification')],
  ['delete-account relay kind is bounded', email.includes("'verify-email' | 'reset-password' | 'delete-account'")],
  ['delete email tells user product account must already be closed', email.includes('제품 계정이 먼저 닫힌 경우에만 동작합니다')],
  ['Better Auth freshness is not disabled', !auth.includes('freshAge: 0') && !auth.includes('freshAge:0')],
  ['no custom unauthenticated hard-delete route is introduced', !auth.includes('/api/v1/me/account/hard-delete')],
  ['auth deletion guard does not mutate product authorization', !auth.includes('update household_memberships') && !auth.includes('update padiem_operator_grants') && !auth.includes('update complex_operator_grants')],
  ['product closure remains the authorization-revocation first step', accountLifecycle.includes("account_status = 'closed'") && accountLifecycle.includes('authorizationRevoked: true')],
  ['product closure still does not falsely claim auth hard deletion', accountLifecycle.includes('authProviderAccountDeleted: false')],
  ['account lifecycle migration defines closed state', accountMigration.includes('account_status') && accountMigration.includes("'active','closed'")],
  ['session rows cascade when Better Auth user is deleted', authMigration.includes('danjion_auth.session') && authMigration.includes("on delete cascade")],
  ['linked account rows cascade when Better Auth user is deleted', authMigration.includes('danjion_auth.account') && authMigration.match(/on delete cascade/g)?.length >= 2],
  ['Drizzle schema preserves user cascade for sessions', authSchema.includes("references(() => user.id, { onDelete: 'cascade' })")],
  ['managed Neon auth schema is not mutated by this boundary', !auth.includes('neon_auth')],
  ['resident verification remains unrelated to auth hard deletion', !auth.includes('resident_verifications') && !auth.includes('verification_status')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} auth deletion boundary contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} auth deletion boundary contract checks passed.`);
