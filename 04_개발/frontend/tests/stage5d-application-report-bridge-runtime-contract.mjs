import assert from 'node:assert/strict';
import {
  createApplicationReportBridge,
  normalizeOwnerApplication,
  normalizeRecommendation
} from '../../../frontend/assets/application-report-bridge.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

{
  const row = normalizeOwnerApplication({
    id: UUID_A, relation_type: 'resident', business_name: '내 가게', category_name: '생활서비스',
    service_summary: '설명', status: 'pending', submission_key: 'owner-key-123', idempotency_replayed: true,
    photoObjectKeys: ['gdrive/public/business-image/a', 'gdrive/public/business-image/b'],
    representative_image_object_key: 'gdrive/public/business-image/a'
  });
  assert.equal(row.relationType, 'resident');
  assert.equal(row.businessName, '내 가게');
  assert.equal(row.submissionKey, 'owner-key-123');
  assert.equal(row.idempotencyReplayed, true);
  assert.deepEqual(row.photoObjectKeys, ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']);
  assert.equal(row.representativeImageObjectKey, 'gdrive/public/business-image/a');
}

{
  const row = normalizeRecommendation({
    id: UUID_B, relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차',
    serviceSummary: '정비', status: 'changes_requested', reviewNote: '보완 요청'
  });
  assert.equal(row.relationType, 'neighbor');
  assert.equal(row.reviewNote, '보완 요청');
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/me/business-applications') && init.method === 'POST') {
      return response(201, { data: { id: UUID_A, relation_type: 'resident', business_name: '내 가게', category_name: '생활서비스', service_summary: '설명', status: 'pending', idempotency_replayed: false } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.createOwnerApplication({ relationType: 'resident', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명' }, { idempotencyKey: 'owner-key-123' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.data.idempotencyReplayed, false);
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['idempotency-key'], 'owner-key-123');
  assert.equal(JSON.parse(calls[0].init.body).complexSlug, 'banglim-myeongji-roadhill');
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/me/business-applications') && init.method === 'POST') {
      return response(201, { data: { id: UUID_A, relation_type: 'resident', business_name: '내 가게', category_name: '생활서비스', service_summary: '설명', status: 'pending', photoObjectKeys: ['gdrive/public/business-image/a', 'gdrive/public/business-image/b'], representative_image_object_key: 'gdrive/public/business-image/a' } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const result = await bridge.createOwnerApplication({
    relationType: 'resident', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명',
    photoObjectKeys: ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.photoObjectKeys, ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']);
  assert.equal(body.representativeImageObjectKey, 'gdrive/public/business-image/a', 'representative must mirror photoObjectKeys[0]');
  assert.deepEqual(result.data.photoObjectKeys, ['gdrive/public/business-image/a', 'gdrive/public/business-image/b']);
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(201, { data: { id: UUID_A, relation_type: 'resident', business_name: '내 가게', category_name: '생활서비스', service_summary: '설명', status: 'pending' } });
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  await bridge.createOwnerApplication({
    relationType: 'resident', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명',
    photoObjectKeys: [], representativeImageObjectKey: 'gdrive/public/business-image/stale'
  });
  const emptyBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(emptyBody.photoObjectKeys, [], 'empty gallery must be sent as authoritative []');
  assert.equal(emptyBody.representativeImageObjectKey, null, 'empty gallery must clear representative even if a stale one was passed');
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return response(201, { data: { id: UUID_A, relation_type: 'resident', business_name: '내 가게', category_name: '생활서비스', service_summary: '설명', status: 'pending' } });
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  await bridge.createOwnerApplication({
    relationType: 'resident', businessName: '내 가게', categoryName: '생활서비스', serviceSummary: '설명',
    representativeImageObjectKey: 'gdrive/public/business-image/legacy'
  });
  const legacyBody = JSON.parse(calls[0].init.body);
  assert.equal(legacyBody.photoObjectKeys, null, 'omitted gallery must stay null so the legacy representative contract is untouched');
  assert.equal(legacyBody.representativeImageObjectKey, 'gdrive/public/business-image/legacy');
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith(`/api/v1/me/business-applications/${UUID_A}`)) {
      return response(200, { data: { id: UUID_A, relation_type: 'resident', business_name: '수정 가게', category_name: '생활서비스', service_summary: '수정 설명', status: 'pending' } });
    }
    throw new Error('unexpected');
  };
  const bridge = createApplicationReportBridge({ fetchImpl });
  const result = await bridge.resubmitOwnerApplication(UUID_A, { relationType: 'resident', businessName: '수정 가게', categoryName: '생활서비스', serviceSummary: '수정 설명' });
  assert.equal(result.ok, true);
  assert.equal(calls[0].init.method, 'PATCH');
}

{
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/api/v1/me/shop-recommendations?complexSlug=')) {
      return response(200, { data: { recommendations: [{ id: UUID_B, relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차', serviceSummary: '정비', status: 'pending' }] } });
    }
    if (url.endsWith('/api/v1/me/shop-recommendations') && init.method === 'POST') {
      return response(201, { data: { id: UUID_B, relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차', serviceSummary: '정비', status: 'pending' } });
    }
    if (url.endsWith(`/api/v1/me/shop-recommendations/${UUID_B}`) && init.method === 'PATCH') {
      return response(200, { data: { id: UUID_B, relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차', serviceSummary: '정비 수정', status: 'pending' } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const bridge = createApplicationReportBridge({ apiBase: 'https://api.example', fetchImpl });
  const list = await bridge.listRecommendations();
  assert.equal(list.ok, true);
  assert.equal(list.data.length, 1);
  const created = await bridge.createRecommendation({ relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차', serviceSummary: '정비' });
  assert.equal(created.status, 201);
  const resubmitted = await bridge.resubmitRecommendation(UUID_B, { relationType: 'neighbor', businessName: '이웃 가게', categoryName: '자동차', serviceSummary: '정비 수정' });
  assert.equal(resubmitted.ok, true);
}

{
  let called = 0;
  const bridge = createApplicationReportBridge({ fetchImpl: async () => { called += 1; return response(500, {}); } });
  const invalidOwner = await bridge.createOwnerApplication({ relationType: 'alien', businessName: 'x', categoryName: 'x', serviceSummary: 'x' });
  assert.equal(invalidOwner.reason, 'validation-error');
  const invalidReport = await bridge.createRecommendation({ relationType: 'resident', businessName: 'x', categoryName: 'x', serviceSummary: 'x' });
  assert.equal(invalidReport.reason, 'validation-error');
  assert.equal(called, 0, 'invalid owner/report relation must fail before network');
}

{
  const bridge = createApplicationReportBridge({ fetchImpl: async () => response(401, { error: { code: 'UNAUTHENTICATED' } }) });
  const result = await bridge.listOwnerApplications();
  assert.equal(result.reason, 'auth-required');
}

{
  const bridge = createApplicationReportBridge({ fetchImpl: async () => { throw new Error('offline'); } });
  const result = await bridge.listRecommendations();
  assert.equal(result.reason, 'network-error');
}

console.log('PASS #278 stage5d application/report bridge runtime');
