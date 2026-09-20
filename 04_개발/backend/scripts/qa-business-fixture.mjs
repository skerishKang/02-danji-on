import { neon } from '@neondatabase/serverless';

const QA_API_HOST = 'padiem-danjion-api-qa.padiem.workers.dev';
const QA_FRONTEND_HOST = 'danjion-qa.pages.dev';
const SYNTHETIC_COMPLEX_SLUG = process.env.DANJION_QA_COMPLEX_SLUG?.trim() || 'banglim-myeongji-roadhill';
const SYNTHETIC_COMPLEX_NAME = process.env.DANJION_QA_COMPLEX_NAME?.trim() || '방림명지로드힐';
const SYNTHETIC_CATEGORY_SLUG = 'qa-acceptance';
const SYNTHETIC_CATEGORY_NAME = '[QA] 인증수용테스트';
const SYNTHETIC_BUSINESS_NAME = '[QA] 인증수용테스트가게';
const SYNTHETIC_BUSINESS_SUMMARY = '#830 authenticated acceptance synthetic business; QA only, no real owner or contact data.';

/*
 * QA-only deterministic identity namespace. Deliberately disjoint from the
 * migration 042 production pilot seed identifiers so a fixture run can never
 * converge onto a real row, and shaped as UUIDv4 so the frontend business-id
 * guard (frontend/assets/reviews-bridge.js) treats it as a real server business.
 */
const FIXTURE_BUSINESS_ID = '71a8300d-0000-4000-8000-000000000001';
const FIXTURE_CATEGORY_ID = '71a8300d-0000-4000-8000-000000000002';
const DISCOVERABLE_COMPLEX_STATUSES = new Set(['active', 'pilot']);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`QA_BUSINESS_FIXTURE_MISSING_INPUT:${name}`);
  return value;
}

function exactHttpsOrigin(raw, name, expectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`QA_BUSINESS_FIXTURE_UNSAFE_TARGET:${name}`);
  }
  return url.origin;
}

function assertQaOnlyAuthority() {
  if (required('APP_ENV') !== 'qa') throw new Error('QA_BUSINESS_FIXTURE_APP_ENV_MUST_BE_QA');
  if (process.env.DATABASE_URL) throw new Error('QA_BUSINESS_FIXTURE_GENERIC_DATABASE_URL_FORBIDDEN');
  const databaseUrl = required('DANJION_QA_DATABASE_URL');
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('QA_BUSINESS_FIXTURE_DATABASE_URL_INVALID');
  return {
    databaseUrl,
    apiOrigin: exactHttpsOrigin(required('DANJION_QA_API_URL'), 'API', QA_API_HOST),
    frontendOrigin: exactHttpsOrigin(required('DANJION_QA_FRONTEND_URL'), 'FRONTEND', QA_FRONTEND_HOST)
  };
}

/*
 * The complex row is authoritative when it already exists: validate it, never
 * rewrite it. Only an absent complex is created, and then in the same
 * synthetic-compatible shape the household fixture converges on.
 */
async function resolveComplex(sql) {
  const created = await sql`
    insert into complexes (slug, name, status)
    values (${SYNTHETIC_COMPLEX_SLUG}, ${SYNTHETIC_COMPLEX_NAME}, 'pilot')
    on conflict (slug) do nothing
    returning id
  `;
  const rows = created[0]?.id
    ? created
    : await sql`select id from complexes where slug = ${SYNTHETIC_COMPLEX_SLUG} limit 1`;
  const complexId = String(rows[0]?.id || '');
  if (!complexId) throw new Error('QA_BUSINESS_FIXTURE_COMPLEX_UNRESOLVED');

  const statusRows = await sql`
    select status from complexes where id = ${complexId}::uuid limit 1
  `;
  const complexStatus = String(statusRows[0]?.status || '');
  if (!DISCOVERABLE_COMPLEX_STATUSES.has(complexStatus)) {
    throw new Error(`QA_BUSINESS_FIXTURE_COMPLEX_NOT_DISCOVERABLE:${complexStatus || 'MISSING'}`);
  }
  return complexId;
}

async function resolveCategory(sql) {
  await sql`
    insert into business_categories (id, slug, name, sort_order, is_active)
    values (${FIXTURE_CATEGORY_ID}::uuid, ${SYNTHETIC_CATEGORY_SLUG}, ${SYNTHETIC_CATEGORY_NAME}, 900, true)
    on conflict (slug)
    do update set name = excluded.name, sort_order = excluded.sort_order, is_active = true
  `;
  const rows = await sql`
    select id, is_active from business_categories where slug = ${SYNTHETIC_CATEGORY_SLUG} limit 1
  `;
  const categoryId = String(rows[0]?.id || '');
  if (!categoryId) throw new Error('QA_BUSINESS_FIXTURE_CATEGORY_UNRESOLVED');
  if (!Boolean(rows[0].is_active)) throw new Error('QA_BUSINESS_FIXTURE_CATEGORY_INACTIVE');
  return categoryId;
}

/*
 * share_slug is intentionally omitted: it is NOT NULL with a server default and
 * guarded by trg_business_share_slug_immutable, so naming it in a do update set
 * would abort every idempotent re-run.
 */
async function upsertBusiness(sql, categoryId) {
  const rows = await sql`
    insert into businesses (
      id, owner_user_id, category_id, kind, name, summary, description, status
    ) values (
      ${FIXTURE_BUSINESS_ID}::uuid,
      null,
      ${categoryId}::uuid,
      'shop',
      ${SYNTHETIC_BUSINESS_NAME},
      ${SYNTHETIC_BUSINESS_SUMMARY},
      ${SYNTHETIC_BUSINESS_SUMMARY},
      'approved'
    )
    on conflict (id)
    do update set
      category_id = excluded.category_id,
      kind = excluded.kind,
      name = excluded.name,
      summary = excluded.summary,
      description = excluded.description,
      status = 'approved',
      updated_at = now()
    returning id
  `;
  const businessId = String(rows[0]?.id || '');
  if (!businessId) throw new Error('QA_BUSINESS_FIXTURE_BUSINESS_UNRESOLVED');
  return businessId;
}

async function attachBusiness(sql, businessId, complexId) {
  const rows = await sql`
    insert into business_complex_relations (
      business_id, complex_id, relation_type, verification_status, priority
    ) values (
      ${businessId}::uuid,
      ${complexId}::uuid,
      'resident',
      'verified',
      1
    )
    on conflict (business_id, complex_id)
    do update set
      relation_type = excluded.relation_type,
      verification_status = 'verified',
      priority = excluded.priority
    returning id
  `;
  if (!rows[0]?.id) throw new Error('QA_BUSINESS_FIXTURE_RELATION_UNRESOLVED');
}

async function attachCategory(sql, businessId, categoryId) {
  await sql`
    insert into business_category_relations (business_id, category_id)
    values (${businessId}::uuid, ${categoryId}::uuid)
    on conflict (business_id, category_id) do nothing
  `;
}

/* Mirrors the public discovery WHERE of src/core-v1.ts exactly. */
async function readback(sql, complexId, businessId) {
  const discovered = await sql`
    select b.id, b.status, r.verification_status, r.relation_type, b.owner_user_id,
      (select count(*) from business_contacts bc where bc.business_id = b.id)::int as contact_count,
      (select count(*) from benefits bt where bt.business_id = b.id)::int as benefit_count,
      (select cc.is_active from business_category_relations br
         join business_categories cc on cc.id = br.category_id
        where br.business_id = b.id limit 1) as category_active,
      (select count(*) from businesses b2
         join business_complex_relations r2 on r2.business_id = b2.id
         join complexes c2 on c2.id = r2.complex_id
        where c2.slug = ${SYNTHETIC_COMPLEX_SLUG}
          and c2.status in ('active','pilot')
          and b2.status = 'approved'
          and r2.verification_status = 'verified') as discoverable_count
    from businesses b
    join business_complex_relations r on r.business_id = b.id
    join complexes c on c.id = r.complex_id
    where c.id = ${complexId}::uuid
      and b.id = ${businessId}::uuid
      and c.status in ('active','pilot')
      and b.status = 'approved'
      and r.verification_status = 'verified'
    limit 1
  `;
  const row = discovered[0];
  if (!row) throw new Error('QA_BUSINESS_FIXTURE_READBACK_MISSING');
  if (String(row.relation_type) !== 'resident') throw new Error('QA_BUSINESS_FIXTURE_RELATION_MISMATCH');
  if (String(row.verification_status) !== 'verified') throw new Error('QA_BUSINESS_FIXTURE_RELATION_NOT_VERIFIED');
  if (String(row.status) !== 'approved') throw new Error('QA_BUSINESS_FIXTURE_BUSINESS_NOT_APPROVED');
  if (Number(row.discoverable_count) < 1) throw new Error('QA_BUSINESS_FIXTURE_DISCOVERY_EMPTY');
  if (row.owner_user_id) throw new Error('QA_BUSINESS_FIXTURE_OWNER_USER_FORBIDDEN');
  if (Number(row.contact_count) > 0) throw new Error('QA_BUSINESS_FIXTURE_CONTACT_FORBIDDEN');
  if (Number(row.benefit_count) > 0) throw new Error('QA_BUSINESS_FIXTURE_BENEFIT_FORBIDDEN');
  if (!Boolean(row.category_active)) throw new Error('QA_BUSINESS_FIXTURE_CATEGORY_NOT_ACTIVE');
  return Number(row.discoverable_count);
}

/*
 * The acceptance harness reads this exact public path through the QA Pages
 * facade, so the fixture proves visibility through the same facade instead of
 * only trusting the database row.
 */
async function readbackPublicDiscovery(frontendOrigin) {
  const target = new URL(`/api/v1/complexes/${encodeURIComponent(SYNTHETIC_COMPLEX_SLUG)}/businesses?limit=50`, frontendOrigin);
  const response = await fetch(target, {
    method: 'GET',
    headers: { accept: 'application/json', origin: frontendOrigin },
    redirect: 'manual'
  });
  if (response.status !== 200) throw new Error(`QA_BUSINESS_FIXTURE_DISCOVERY_HTTP_${response.status}`);
  const body = await response.json().catch(() => null);
  const rows = Array.isArray(body?.data) ? body.data : null;
  if (!rows) throw new Error('QA_BUSINESS_FIXTURE_DISCOVERY_SHAPE');
  const matched = rows.some((row) => String(row?.id || '') === FIXTURE_BUSINESS_ID);
  if (!matched) throw new Error('QA_BUSINESS_FIXTURE_DISCOVERY_MISSING');
  return { httpStatus: response.status, businessCount: rows.length, matched };
}

async function main() {
  const { databaseUrl, frontendOrigin } = assertQaOnlyAuthority();
  const sql = neon(databaseUrl);

  const complexId = await resolveComplex(sql);
  const categoryId = await resolveCategory(sql);
  const businessId = await upsertBusiness(sql, categoryId);
  await attachBusiness(sql, businessId, complexId);
  await attachCategory(sql, businessId, categoryId);

  const discoverableCount = await readback(sql, complexId, businessId);
  const discovery = await readbackPublicDiscovery(frontendOrigin);

  console.log('QA_BUSINESS_FIXTURE_PRESENT=true');
  console.log(`QA_BUSINESS_COUNT=${discoverableCount}`);
  console.log('QA_BUSINESS_APPROVED=true');
  console.log('QA_BUSINESS_RELATION_PRESENT=true');
  console.log('QA_BUSINESS_CATEGORY_ACTIVE=true');
  console.log('QA_BUSINESS_OWNER_USER_PRESENT=false');
  console.log(`QA_BUSINESS_DISCOVERY_HTTP=${discovery.httpStatus}`);
  console.log(`QA_BUSINESS_DISCOVERY_MATCHED=${discovery.matched}`);
  console.log(`QA_BUSINESS_DISCOVERY_ROWS=${discovery.businessCount}`);
  console.log(`QA_FIXTURE_BUSINESS_ID_PREFIX=${FIXTURE_BUSINESS_ID.slice(0, 8)}`);
  console.log('SYNTHETIC_FIXTURE=true');
  console.log('PRODUCTION_TARGET=NO');
  console.log('SECRET_OUTPUT=NO');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'QA_BUSINESS_FIXTURE_FAILED');
  process.exit(1);
});
