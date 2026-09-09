import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const core = read('src/core-v1.ts');
const schema = read('migrations/001_initial_schema.sql');

const checks = [
  ['bookmarks table exists', schema.includes('create table if not exists bookmarks')],
  ['bookmarks are user/business scoped', schema.includes('primary key (user_id, business_id)')],
  ['bookmark user FK cascades on delete', schema.includes('user_id uuid not null references app_users(id) on delete cascade')],
  ['bookmark business FK cascades on delete', schema.includes('business_id uuid not null references businesses(id) on delete cascade')],
  ['private core requires actor before bookmark routes', core.includes('const actorOrResponse = await requireActor(request, env, sql, id)') && core.indexOf('const actorOrResponse = await requireActor(request, env, sql, id)') < core.indexOf("path === '/api/v1/me/bookmarks'")],
  ['bookmark list endpoint exists', core.includes("request.method === 'GET' && path === '/api/v1/me/bookmarks'")],
  ['bookmark list is actor scoped', core.includes('where bm.user_id = ${actor.id}::uuid and b.status = \'approved\'')],
  ['bookmark list returns only approved businesses', core.includes("b.status = 'approved'")],
  ['bookmark create endpoint exists', core.includes("request.method === 'POST'") && core.includes('/api\\/v1\\/me\\/bookmarks\\/([0-9a-fA-F-]+)')],
  ['bookmark create accepts approved business only', core.includes('where b.id = ${businessId}::uuid and b.status = \'approved\'')],
  ['bookmark create is idempotent', core.includes('on conflict (user_id, business_id) do nothing')],
  ['bookmark create reports missing business', core.includes("fail('NOT_FOUND', 'Business not found', 404, id)")],
  ['bookmark delete endpoint exists', core.includes("request.method === 'DELETE'") && core.includes('delete from bookmarks where user_id = ${actor.id}::uuid and business_id = ${businessId}::uuid')],
  ['bookmark delete cannot target another actor', !core.includes('delete from bookmarks where business_id = ${businessId}::uuid')],
  ['bookmark writes never require resident-verification authority', !core.slice(core.indexOf("path === '/api/v1/me/bookmarks'"), core.indexOf("path === '/api/v1/me/business-applications'")).includes('requireVerifiedResident')]
];

const failed = checks.filter(([, pass]) => !pass);
for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`\n${failed.length} saved-shops contract check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} saved-shops server contract checks passed.`);
