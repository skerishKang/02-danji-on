import assert from 'node:assert/strict';
import {
  handleShopRecommendationWithSql,
  preResolveRelation,
  recommendationInput
} from '../src/shop-recommendations-v1.ts';

// Report R-B runtime proof without Docker: pure intake parsing plus the full
// resident-create and operator-approve HTTP paths against a stubbed sql()
// that answers the exact queries the handlers issue. No network, no database.

const ACTOR_ID = '71000000-0000-4000-8000-000000000001';
const COMPLEX_ID = '72000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '73000000-0000-4000-8000-000000000001';
const BUSINESS_ID = '74000000-0000-4000-8000-000000000001';
const REC_ID = '70000000-0000-4000-8000-000000000001';
const CREATED_ID = '70000000-0000-4000-8000-000000000002';

const ENV = {
  DATABASE_URL: 'postgresql://unused-in-stub-test',
  APP_ENV: 'development',
  DEV_AUTH_BYPASS: 'true'
};

// ---------------------------------------------------------------- pure intake
{
  const family = recommendationInput({
    complexSlug: 'rb-complex', relationType: 'family', businessName: 'Fam',
    serviceSummary: 'Family shop'
  });
  assert.ok(family, 'family report must parse');
  assert.equal(family.reportedRelationRaw, 'family');
  assert.equal(family.categoryName, null, 'category must be optional at intake');
  assert.equal(preResolveRelation(family.reportedRelationRaw), 'resident_family');

  const neighbor = recommendationInput({
    complexSlug: 'rb-complex', relationType: 'neighbor', businessName: 'N',
    serviceSummary: 'Neighbor shop', categoryName: 'RB Food'
  });
  assert.ok(neighbor);
  assert.equal(preResolveRelation(neighbor.reportedRelationRaw), 'neighbor');

  const nearby = recommendationInput({
    complexSlug: 'rb-complex', relationType: 'nearby', businessName: 'N',
    serviceSummary: 'Nearby shop'
  });
  assert.ok(nearby, 'nearby report must parse (raw always preserved)');
  assert.equal(preResolveRelation(nearby.reportedRelationRaw), null,
    'nearby must NOT pre-resolve (nearby -> local is forbidden)');

  const etc = recommendationInput({
    complexSlug: 'rb-complex', relationType: 'etc', businessName: 'E',
    serviceSummary: 'Etc shop', relationDetail: 'friend of a friend',
    reportPrice: '5,000', reportHours: '09-18'
  });
  assert.ok(etc, 'etc report must parse');
  assert.equal(preResolveRelation(etc.reportedRelationRaw), null);
  assert.equal(etc.relationDetail, 'friend of a friend');
  assert.equal(etc.reportPrice, '5,000');
  assert.equal(etc.reportHours, '09-18');

  const alias = recommendationInput({
    complexSlug: 'rb-complex', relationRaw: 'neighbor', businessName: 'N',
    serviceSummary: 'Alias shop'
  });
  assert.ok(alias, 'relationRaw alias must parse');
  assert.equal(alias.reportedRelationRaw, 'neighbor');

  assert.equal(recommendationInput({ complexSlug: 'rb-complex', businessName: 'X', serviceSummary: 'Y' }), null,
    'missing relation must be rejected');
  assert.equal(recommendationInput({ complexSlug: 'rb-complex', relationType: '', businessName: 'X', serviceSummary: 'Y' }), null,
    'empty relation must be rejected');
  assert.equal(recommendationInput({ complexSlug: 'rb-complex', relationType: 'n'.repeat(121), businessName: 'X', serviceSummary: 'Y' }), null,
    'overlong raw relation must be rejected');
  assert.equal(recommendationInput({ complexSlug: 'rb-complex', relationType: 'neighbor', businessName: 'X', serviceSummary: 'Y', reportPrice: 'p'.repeat(121) }), null,
    'overlong report price must be rejected');
  assert.equal(recommendationInput({ complexSlug: 'rb-complex', relationType: 'neighbor', businessName: 'X', serviceSummary: 'Y', relationDetail: 'd'.repeat(1001) }), null,
    'overlong relation detail must be rejected');
  console.log('PASS report R-B intake parsing and pre-resolution (pure)');
}

// ---------------------------------------------------------------- stub sql
function stubSql({ currentRow = null, authorityRow = { id: CATEGORY_ID, is_active: true }, approvedRow = null } = {}) {
  const seen = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    seen.push({ text, values });
    if (text.includes('with approved as (')) return approvedRow ? [approvedRow] : [];
    if (text.includes("set status = 'changes_requested'")) {
      return [{ id: REC_ID, status: 'changes_requested', review_note: values[0], reviewed_at: '2026-09-10T00:00:00.000Z' }];
    }
    if (text.includes('insert into shop_recommendations')) {
      return [{
        id: CREATED_ID,
        relation_type: values[2],
        reported_relation_raw: values[3],
        resolved_relation_type: values[4],
        relation_detail: values[5],
        business_name: values[6],
        category_name: values[7],
        resolved_category_id: values[8],
        service_summary: values[9],
        service_area: values[10],
        reporter_note: values[11],
        report_price: values[12],
        report_hours: values[13],
        status: 'pending',
        review_note: null,
        approved_business_id: null,
        created_at: '2026-09-10T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z'
      }];
    }
    if (text.includes('from shop_recommendations r') && text.includes('join complexes c')) {
      return currentRow ? [currentRow] : [];
    }
    if (text.includes('from business_categories bc') && text.includes('where bc.name =')) {
      return values[0] === 'RB Food' ? [{ id: CATEGORY_ID }] : [];
    }
    if (text.includes('from business_categories bc') && text.includes('where bc.id =')) {
      return authorityRow ? [authorityRow] : [];
    }
    if (text.includes('from household_memberships hm')) {
      return [{
        membership_id: '75000000-0000-4000-8000-000000000001',
        membership_role: 'member',
        household_id: '75100000-0000-4000-8000-000000000001',
        complex_id: COMPLEX_ID,
        complex_slug: 'rb-complex'
      }];
    }
    if (text.includes('padiem_operator_grants')) {
      return [{
        complex_id: COMPLEX_ID,
        complex_slug: 'rb-complex',
        padiem_grant_id: '75200000-0000-4000-8000-000000000001',
        padiem_granted_scope: 'business.review',
        council_grant_id: null,
        council_granted_scope: null
      }];
    }
    if (text.includes('from app_users') && text.includes('where auth_user_id =')) {
      return [{ id: ACTOR_ID, auth_user_id: values[0], display_name: 'Stub', account_status: 'active' }];
    }
    return [];
  };
  return { sql, seen };
}

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-danjion-dev-auth-user': 'stub-subject'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

// ------------------------------------------------- B1: create family + category
{
  const { sql, seen } = stubSql();
  const res = await handleShopRecommendationWithSql(
    jsonRequest('http://test/api/v1/me/shop-recommendations', 'POST', {
      complexSlug: 'rb-complex', relationType: 'family', businessName: 'Fam Shop',
      categoryName: 'RB Food', serviceSummary: 'Family rec'
    }),
    ENV, sql, 'rb-b1'
  );
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.reportedRelationRaw, 'family', 'raw must be preserved verbatim');
  assert.equal(data.resolvedRelationType, 'resident_family', 'family must pre-resolve');
  assert.equal(data.relationType, 'resident_family', 'legacy relation mirrors resolved');
  assert.equal(data.resolvedCategoryId, CATEGORY_ID, 'exact active category resolves at intake');
  const insert = seen.find((q) => q.text.includes('insert into shop_recommendations'));
  assert.ok(insert, 'create must issue the R-B insert');
  assert.equal(insert.values[2], 'resident_family');
  assert.equal(insert.values[3], 'family');
  assert.equal(insert.values[8], CATEGORY_ID);
  console.log('PASS report R-B create persists raw + pre-resolved family (stub SQL)');
}

// ------------------------------------------------- B2: create nearby, no category
{
  const { sql, seen } = stubSql();
  const res = await handleShopRecommendationWithSql(
    jsonRequest('http://test/api/v1/me/shop-recommendations', 'POST', {
      complexSlug: 'rb-complex', relationType: 'nearby', businessName: 'Near Shop',
      serviceSummary: 'Nearby rec'
    }),
    ENV, sql, 'rb-b2'
  );
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.reportedRelationRaw, 'nearby');
  assert.equal(data.resolvedRelationType, null, 'nearby stays unresolved');
  assert.equal(data.relationType, null, 'legacy relation stays null while unresolved');
  assert.equal(data.resolvedCategoryId, null, 'missing category stays unresolved');
  assert.equal(data.categoryName, null);
  const insert = seen.find((q) => q.text.includes('insert into shop_recommendations'));
  assert.equal(insert.values[2], null);
  assert.equal(insert.values[3], 'nearby');
  assert.equal(insert.values[4], null);
  console.log('PASS report R-B create keeps nearby raw with resolved NULL (stub SQL)');
}

// --------------------------------- B3: approve unresolved -> changes_requested
{
  const { sql, seen } = stubSql({
    currentRow: {
      id: REC_ID, status: 'pending', approved_business_id: null,
      resolved_category_id: null, resolved_relation_type: null, complex_slug: 'rb-complex'
    }
  });
  const res = await handleShopRecommendationWithSql(
    jsonRequest(`http://test/api/v1/admin/shop-recommendations/${REC_ID}`, 'PATCH', { status: 'approved' }),
    ENV, sql, 'rb-b3'
  );
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.status, 'changes_requested', 'unresolved approval must fail closed to changes_requested');
  assert.equal(data.categoryUnresolved, 'REPORT_RB_UNRESOLVED');
  assert.ok(!seen.some((q) => q.text.includes('with approved as (')),
    'unresolved approval must never reach the materialization CTE');
  console.log('PASS report R-B unresolved approval fails closed (stub SQL)');
}

// --------------------------------- B4: approve resolved -> approved, R-B CTE
{
  const { sql, seen } = stubSql({
    currentRow: {
      id: REC_ID, status: 'pending', approved_business_id: null,
      resolved_category_id: CATEGORY_ID, resolved_relation_type: 'resident_family',
      complex_slug: 'rb-complex'
    },
    approvedRow: {
      id: REC_ID, status: 'approved', review_note: 'verified',
      approved_business_id: BUSINESS_ID, reviewed_at: '2026-09-10T00:00:00.000Z'
    }
  });
  const res = await handleShopRecommendationWithSql(
    jsonRequest(`http://test/api/v1/admin/shop-recommendations/${REC_ID}`, 'PATCH', { status: 'approved', reviewNote: 'verified' }),
    ENV, sql, 'rb-b4'
  );
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.status, 'approved');
  assert.equal(data.approved_business_id, BUSINESS_ID);
  const cte = seen.find((q) => q.text.includes('with approved as ('));
  assert.ok(cte, 'resolved approval must run the atomic CTE');
  assert.ok(cte.text.includes('r.resolved_category_id is not null'), 'CTE must gate on resolved_category_id');
  assert.ok(cte.text.includes('r.resolved_relation_type is not null'), 'CTE must gate on resolved_relation_type');
  assert.ok(cte.text.includes('where bc.id = r.resolved_category_id'), 'CTE must gate on the active canonical id');
  assert.ok(cte.text.includes('a.resolved_category_id,'), 'business must materialize resolved_category_id');
  assert.ok(cte.text.includes('a.complex_id, a.resolved_relation_type,'), 'relation must materialize resolved_relation_type');
  assert.ok(!cte.text.includes('category_name'), 'CTE must never read legacy category_name');
  assert.ok(!cte.text.includes('a.relation_type'), 'relation must not use legacy relation_type');
  console.log('PASS report R-B resolved approval runs the resolved-only atomic CTE (stub SQL)');
}

// --------------------------- B5: approve resolved but inactive -> fail closed
{
  const { sql, seen } = stubSql({
    currentRow: {
      id: REC_ID, status: 'pending', approved_business_id: null,
      resolved_category_id: CATEGORY_ID, resolved_relation_type: 'neighbor',
      complex_slug: 'rb-complex'
    },
    authorityRow: { id: CATEGORY_ID, is_active: false }
  });
  const res = await handleShopRecommendationWithSql(
    jsonRequest(`http://test/api/v1/admin/shop-recommendations/${REC_ID}`, 'PATCH', { status: 'approved' }),
    ENV, sql, 'rb-b5'
  );
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.status, 'changes_requested', 'inactive category must fail closed');
  assert.equal(data.categoryUnresolved, 'CATEGORY_NOT_ACTIVE');
  assert.ok(!seen.some((q) => q.text.includes('with approved as (')),
    'inactive authority must never reach the materialization CTE');
  console.log('PASS report R-B inactive authority fails closed (stub SQL)');
}

console.log('PASS report R-B runtime: intake pre-resolution and resolved-only approval (stub SQL)');
