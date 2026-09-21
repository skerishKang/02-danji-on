import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createApplicationReportBridge,
  normalizeRecommendation
} from '../../../frontend/assets/application-report-bridge.js';

// KILO3: canonical 25A report lane -> Report R-B backend (#308 authority).
// 1. report server path actually calls createRecommendation
// 2. no category synthesis
// 3. nearby not coerced to local (family/neighbor raw preserved for backend pre-resolve)
// 4. etc detail preserved
// 5. price/hours forwarded
// 6. 401/403 fail closed
// 7. 5xx/network fail closed
// 8. no fake success / no server-persistence claim (25A static wiring)

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

const RB_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  relation_type: null,
  reported_relation_raw: 'nearby',
  resolved_relation_type: null,
  relation_detail: null,
  business_name: '가까운 가게',
  category_name: null,
  resolved_category_id: null,
  service_summary: '설명',
  service_area: '위치',
  reporter_note: '추천 이유',
  report_price: '5,000',
  report_hours: '09-18',
  status: 'pending',
  review_note: null,
  approved_business_id: null
};

// 1+2+3+4+5: full R-B payload reaches POST /api/v1/me/shop-recommendations
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/me/shop-recommendations') && init.method === 'POST') {
      return response(201, { data: RB_ROW });
    }
    throw new Error(`unexpected ${init.method} ${url}`);
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.createRecommendation({
    relationRaw: 'nearby',
    businessName: '가까운 가게',
    serviceSummary: '설명',
    serviceArea: '위치',
    reporterNote: '추천 이유',
    reportPrice: '5,000',
    reportHours: '09-18'
  });
  assert.equal(result.ok, true, '1. report server path must call createRecommendation and succeed on 201');
  assert.equal(result.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, 'include');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.relationRaw, 'nearby', '3. nearby raw must be preserved verbatim');
  assert.ok(!('relationType' in body), 'no legacy relation coercion field');
  assert.ok(!JSON.stringify(body).includes('local'), '3. nearby must never be coerced to local');
  assert.ok(!('categoryName' in body), '2. no category synthesis when reporter supplied none');
  assert.equal(body.serviceSummary, '설명');
  assert.equal(body.reportPrice, '5,000', '5. price forwarded');
  assert.equal(body.reportHours, '09-18', '5. hours forwarded');
  assert.equal(result.data.reportedRelationRaw, 'nearby');
  assert.equal(result.data.resolvedRelationType, null);
  assert.equal(result.data.reportPrice, '5,000');
  assert.equal(result.data.reportHours, '09-18');
}

// 3: family / neighbor raw preserved for backend pre-resolution
for (const raw of ['family', 'neighbor']) {
  let sent = null;
  const fetchImpl = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return response(201, { data: { ...RB_ROW, reported_relation_raw: raw } });
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.createRecommendation({ relationRaw: raw, businessName: '가게', serviceSummary: '설명' });
  assert.equal(result.ok, true);
  assert.equal(sent.relationRaw, raw, `${raw} must stay raw (backend pre-resolves)`);
}

// 4: etc stays raw + detail preserved
{
  let sent = null;
  const fetchImpl = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return response(201, { data: { ...RB_ROW, reported_relation_raw: 'etc', relation_detail: '지인의 지인' } });
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.createRecommendation({
    relationRaw: 'etc', businessName: '가게', serviceSummary: '설명', relationDetail: '지인의 지인'
  });
  assert.equal(result.ok, true);
  assert.equal(sent.relationRaw, 'etc', 'etc stays raw');
  assert.equal(sent.relationDetail, '지인의 지인', '4. etc detail preserved');
  assert.equal(result.data.relationDetail, '지인의 지인');
}

// 2: supplied category passes through verbatim, never invented
{
  let sent = null;
  const fetchImpl = async (url, init = {}) => {
    sent = JSON.parse(init.body);
    return response(201, { data: RB_ROW });
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  await bridge.createRecommendation({ relationRaw: 'neighbor', businessName: '가게', serviceSummary: '설명', categoryName: '자동차' });
  assert.equal(sent.categoryName, '자동차', 'supplied category passes through verbatim');
}

// 6: 401/403 fail closed with their canonical discriminated reasons
// #763 split the old blanket 'auth-required' into distinct fail-closed reasons:
// 401 keeps 'auth-required', while 403 resolves to 'resident-verification-required'
// for the resident gates and 'forbidden' otherwise. Every one of them is a
// fail-closed rejection — none of them may ever report ok:true.
for (const [status, code, reason] of [
  [401, null, 'auth-required'],
  [403, 'RESIDENT_VERIFICATION_REQUIRED', 'resident-verification-required'],
  [403, 'HOUSEHOLD_ASSOCIATION_REQUIRED', 'resident-verification-required'],
  [403, 'FORBIDDEN', 'forbidden'],
  [403, null, 'forbidden']
]) {
  const bridge = createApplicationReportBridge({ fetchImpl: async () => response(status, { error: { code } }) });
  const result = await bridge.createRecommendation({ relationRaw: 'neighbor', businessName: '가게', serviceSummary: '설명' });
  assert.equal(result.ok, false, `${status}/${code} must not succeed`);
  assert.equal(result.reason, reason, `${status}/${code} must fail closed as ${reason}`);
}

// 7: 5xx / network fail closed, never ok:true
{
  const bridge500 = createApplicationReportBridge({ fetchImpl: async () => response(500, {}) });
  const r500 = await bridge500.createRecommendation({ relationRaw: 'neighbor', businessName: '가게', serviceSummary: '설명' });
  assert.equal(r500.ok, false);
  assert.equal(r500.reason, 'server-error');
  const bridgeDown = createApplicationReportBridge({ fetchImpl: async () => { throw new Error('offline'); } });
  const rDown = await bridgeDown.createRecommendation({ relationRaw: 'neighbor', businessName: '가게', serviceSummary: '설명' });
  assert.equal(rDown.ok, false);
  assert.equal(rDown.reason, 'network-error');
}

// normalizeRecommendation R-B shape
{
  const row = normalizeRecommendation(RB_ROW);
  assert.equal(row.reportedRelationRaw, 'nearby');
  assert.equal(row.resolvedRelationType, null);
  assert.equal(row.categoryName, null);
  assert.equal(row.resolvedCategoryId, null);
  assert.equal(row.reportPrice, '5,000');
  assert.equal(row.reportHours, '09-18');
}

// 8: 25A static wiring — server call, no DEMO early-return for server mode,
// no category synthesis, no fake server-persistence claim
{
  const html = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');
  assert.ok(html.includes('bridge.createRecommendation'), '8. 25A report path must call bridge.createRecommendation');
  assert.ok(!html.includes('isReport||!danjionApiBase()'), '8. DEMO_ONLY combined early-return must be gone');
  const reportCall = html.match(/createRecommendation\(\{[^}]*\}\)/s);
  assert.ok(reportCall, '8. report call site must exist');
  assert.ok(/relationRaw/.test(reportCall[0]), '8. report call must send raw relation');
  assert.ok(!/categoryName/.test(reportCall[0]), '8. report call must not synthesize categoryName');
  assert.ok(!/relationType/.test(reportCall[0]), '8. report call must not coerce legacy relationType');
  assert.ok(html.includes('제보 내용 확인 완료'), '8. no-apiBase demo toast preserved');
  assert.ok(html.includes('제보가 접수됐습니다'), '8. server success toast exists');
  const successIdx = html.indexOf('제보가 접수됐습니다');
  const callIdx = html.indexOf('bridge.createRecommendation');
  assert.ok(successIdx > callIdx, '8. success copy only after the real server call');
  const failIdx = html.indexOf('접수를 완료하지 못했습니다');
  assert.ok(failIdx > callIdx, '8. failure toast must exist on the report server path');
  // The marker scan targets real category synthesis, so it must look at executable
  // code only. `fake` legitimately appears in prose assertions such as
  // "no local fake persistence", which is the opposite of a synthetic marker.
  const htmlCode = html
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
    .join('\n');
  assert.ok(!/미분류|UNCATEGORIZED|가짜/.test(htmlCode), '8. no synthetic/fake category markers');
  assert.ok(!/\bfake[A-Za-z]*\s*[:=(]/.test(htmlCode), '8. no fabricated category/identifier assignment');
}

console.log('PASS KILO3 stage5h report R-B frontend wiring contract');

/* ===== #830: canonical Production report lane (product source logic) ===== */

/*
 * The REPORT path treated an empty danjionApiBase() as the static/demo lane. Canonical
 * Production legitimately serves same-origin with an empty base, so the demo fallback must
 * additionally require !DanjionSession.isCanonicalProduction() — the same rule the
 * myApplications panel in this file already applies.
 */
const reportPage = await readFile(new URL('../../../frontend/25A_신청제보.html', import.meta.url), 'utf8');

function extractReportDemoGuard(source) {
  const fnAt = source.indexOf('async function submitReport(');
  assert.ok(fnAt >= 0, 'submitReport must exist in 25A');
  const guardAt = source.indexOf('if(', fnAt);
  assert.ok(guardAt > fnAt, 'the report demo guard must exist');
  const guardEnd = source.indexOf('){', guardAt);
  assert.ok(guardEnd > guardAt, 'the report demo guard must be a complete condition');
  return source.slice(guardAt + 3, guardEnd);
}

/* The extracted guard is executed, not quoted. */
function reportTakesDemoReturn(source, { apiBase, canonicalProduction }) {
  const guard = extractReportDemoGuard(source);
  const evaluate = new Function('danjionApiBase', 'DanjionSession', 'return Boolean(' + guard + ');');
  return evaluate(() => apiBase, { isCanonicalProduction: () => canonicalProduction });
}

function assertReportCanonicalServerPath(source) {
  if (reportTakesDemoReturn(source, { apiBase: '', canonicalProduction: true })) {
    throw new Error('REPORT_CANONICAL_PRODUCTION_SERVER_PATH: canonical production must not take the demo return');
  }
  return true;
}

/* A. canonical Production, empty base -> server path, never the demo return. */
assert.equal(assertReportCanonicalServerPath(reportPage), true);
assert.equal(reportTakesDemoReturn(reportPage, { apiBase: '', canonicalProduction: true }), false,
  'DEMO_RETURN=NO / SERVER_REPORT_PATH=YES on canonical Production');
/* B. static/demo lane -> the demo return is still taken. */
assert.equal(reportTakesDemoReturn(reportPage, { apiBase: '', canonicalProduction: false }), true,
  'DEMO_RETURN=YES on the static lane');
/* C. an explicit api base -> server path regardless of the canonical flag. */
assert.equal(reportTakesDemoReturn(reportPage, { apiBase: 'https://api.example', canonicalProduction: false }), false,
  'SERVER_REPORT_PATH=YES with an explicit api base');

/* The demo toast may only live inside the canonical-guarded branch. */
const REPORT_DEMO_TOAST = '제보 내용 확인 완료';
const reportDemoToastAt = reportPage.indexOf(REPORT_DEMO_TOAST);
const reportGuardAt = reportPage.indexOf("if(!danjionApiBase()&&!DanjionSession.isCanonicalProduction()){");
assert.ok(reportGuardAt >= 0, 'the report guard must be canonical aware');
assert.ok(reportDemoToastAt > reportGuardAt, 'the report demo toast must sit behind the canonical-aware guard');
const SUCCESS_TOAST = '제보가 접수됐습니다';
assert.ok(reportPage.indexOf(SUCCESS_TOAST) > reportPage.indexOf('if(!result.ok){'),
  'SUCCESS_TOAST_AFTER_2XX_ONLY: the success toast must follow the result.ok check');

/* Scope: the owner application path is the #809 lane and must stay untouched. */
/* #809 fixed the owner lane in this same file: that lane now carries its own canonical-aware guard
   and its detailed semantics are pinned in stage5k-owner-relation-raw. What stage5h must still
   guarantee is that the report lane itself is unchanged and that no legacy demo-only guard
   survives anywhere in 25A. */
assert.equal(reportPage.split('if(!danjionApiBase()){').length - 1, 0,
  'no legacy demo-only guard may remain in 25A; report and owner are both canonical aware');
assert.equal(reportPage.split('!danjionApiBase()&&!DanjionSession.isCanonicalProduction()').length - 1, 2,
  'the report lane (#830) and the owner lane (#809) each carry exactly one canonical-aware guard');

/* Bridge contract for the empty base: same-origin path, POST, credentials included. */
{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(201, { data: RB_ROW });
  };
  const bridge = createApplicationReportBridge({ apiBase: '', fetchImpl });
  const result = await bridge.createRecommendation({ relationRaw: 'nearby', businessName: '가까운 가게',
    serviceSummary: '설명', serviceArea: '위치', reporterNote: '추천 이유' });
  assert.equal(calls.length, 1, "an empty apiBase must issue exactly one request");
  assert.equal(calls[0].url, '/api/v1/me/shop-recommendations',
    'BRIDGE_EMPTY_BASE_SAME_ORIGIN: an empty apiBase must resolve to the same-origin path');
  assert.equal(calls[0].init.method, 'POST', 'the report must be a POST');
  assert.equal(calls[0].init.credentials, 'include', 'the report must carry credentials');
  assert.equal(result.ok, true);
}

/* Executable mutation proof: dropping the canonical disjunct must make the verifier throw. */
const REPORT_CANONICAL_GUARD = '!danjionApiBase()&&!DanjionSession.isCanonicalProduction()';
const mutatedReportPage = reportPage.replace(REPORT_CANONICAL_GUARD, '!danjionApiBase()');
assert.notEqual(mutatedReportPage, reportPage, 'the mutation must actually change the guard');
assert.throws(() => assertReportCanonicalServerPath(mutatedReportPage), /REPORT_CANONICAL_PRODUCTION_SERVER_PATH/,
  'REPORT_CANONICAL_PRODUCTION_MUTATION_PROOF: the verifier must throw without the canonical semantics');

process.stdout.write('REPORT_CANONICAL_PRODUCTION_SERVER_PATH=PASS\n');
process.stdout.write('REPORT_DEMO_FALLBACK=PASS\n');
process.stdout.write('REPORT_CANONICAL_PRODUCTION_MUTATION_PROOF=PASS\n');
process.stdout.write('BRIDGE_EMPTY_BASE_SAME_ORIGIN=PASS\n');
process.stdout.write('SUCCESS_TOAST_AFTER_2XX_ONLY=PASS\n');
process.stdout.write('REPORT_LANE_UNCHANGED=PASS\n');
