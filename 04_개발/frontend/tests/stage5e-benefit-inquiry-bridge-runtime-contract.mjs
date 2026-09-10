import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../../', import.meta.url);
const benefitSource = await readFile(new URL('frontend/assets/benefit-claim-bridge.js', root), 'utf8');
const inquirySource = await readFile(new URL('frontend/assets/inquiry-bridge.js', root), 'utf8');

function makeSandbox(source, extraFetch) {
  const sandbox = {
    globalThis: {},
    location: { origin: 'https://danjion.pages.dev' },
    fetch: extraFetch || (async () => { throw new Error('unexpected fetch'); }),
    URL,
    encodeURIComponent,
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
}

const makeResponse = (status, data) => ({
  ok: status >= 200 && status < 300,
  status,
  async json(){ return status >= 200 && status < 300 ? { data } : { error: { code: data } }; }
});

const BENEFIT_ID = 'c0a1c4a1-3333-4333-8333-333333333333';
const COMPLEX_SLUG = 'banglim-myeongji-roadhill';

/* ---------------- benefit-claim-bridge ---------------- */
{
  const sandbox = makeSandbox(benefitSource);
  const { createBenefitClaimBridge, benefitIdFromValue, normalizeClaim, normalizeWalletRow } = sandbox.DanjionBenefitClaimBridge;
  assert.ok(createBenefitClaimBridge);

  assert.equal(benefitIdFromValue(BENEFIT_ID), BENEFIT_ID);
  assert.equal(benefitIdFromValue('api-' + BENEFIT_ID), null);
  assert.equal(benefitIdFromValue('not-a-uuid'), null);
  assert.equal(benefitIdFromValue(null), null);

  assert.equal(normalizeClaim({ id: 'c1', benefit_id: BENEFIT_ID, claim_code: 'DANJION-ABCD1234', status: 'claimed', claimed_at: 't1', used_at: null }).claimCode, 'DANJION-ABCD1234');
  assert.equal(normalizeClaim(null), null);
  assert.equal(normalizeWalletRow({ id: 'w1', benefit_id: BENEFIT_ID, business_id: 'b1', business_name: '가게', title: '혜택', complex_slug: COMPLEX_SLUG }).businessName, '가게');
  assert.equal(normalizeWalletRow(null), null);

  // claim: canonical endpoint, JSON payload with complexSlug, credentials included.
  {
    let captured;
    const bridge = createBenefitClaimBridge({
      apiBase: 'https://api.example.test/',
      complexSlug: COMPLEX_SLUG,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return makeResponse(201, { id: 'c1', benefit_id: BENEFIT_ID, claim_code: 'DANJION-ABCD1234', status: 'claimed', claimed_at: 't1', used_at: null });
      }
    });
    const result = await bridge.claim(BENEFIT_ID);
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'server');
    assert.equal(result.status, 201);
    assert.equal(result.claim.claimCode, 'DANJION-ABCD1234');
    assert.match(captured.url, new RegExp(`/api/v1/me/benefits/${BENEFIT_ID}/claim$`));
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.credentials, 'include');
    assert.deepEqual(JSON.parse(captured.init.body), { complexSlug: COMPLEX_SLUG });
  }

  // claim replay: 200 with the same row shape is accepted.
  {
    const bridge = createBenefitClaimBridge({ fetchImpl: async () => makeResponse(200, { id: 'c1', benefit_id: BENEFIT_ID, claim_code: 'DANJION-ABCD1234', status: 'claimed', claimed_at: 't1', used_at: null }) });
    const result = await bridge.claim(BENEFIT_ID);
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  }

  // non-UUID ids never hit the authenticated benefit API (static/demo boundary).
  {
    let called = false;
    const bridge = createBenefitClaimBridge({ fetchImpl: async () => { called = true; } });
    const result = await bridge.claim('not-a-uuid');
    assert.equal(result.mode, 'static');
    assert.equal(result.error, 'BENEFIT_ID_REQUIRED');
    assert.equal(called, false);
  }

  // 401/403 are explicit auth boundaries; bridge does not fake success.
  for (const status of [401, 403]) {
    const bridge = createBenefitClaimBridge({ fetchImpl: async () => makeResponse(status, 'AUTH_REQUIRED') });
    const result = await bridge.claim(BENEFIT_ID);
    assert.equal(result.mode, 'auth-required');
    assert.equal(result.status, status);
    assert.equal(result.ok, false);
  }

  // network failure and server errors fail closed with mode error.
  {
    const bridge = createBenefitClaimBridge({ fetchImpl: async () => { throw new Error('offline'); } });
    const result = await bridge.claim(BENEFIT_ID);
    assert.equal(result.mode, 'error');
    assert.equal(result.status, 0);
    assert.equal(result.error, 'NETWORK_ERROR');
  }

  // wallet list: GET /me/benefits returns a bare array.
  {
    const bridge = createBenefitClaimBridge({
      apiBase: 'https://api.example.test',
      fetchImpl: async () => makeResponse(200, [{ id: 'w1', benefit_id: BENEFIT_ID, claim_code: 'DANJION-ABCD1234', status: 'claimed', business_id: 'b1', business_name: '로드힐 꽃작업실', complex_slug: COMPLEX_SLUG, complex_name: '방림명지로드힐' }])
    });
    const result = await bridge.listMine();
    assert.equal(result.mode, 'server');
    assert.equal(result.benefits.length, 1);
    assert.equal(result.benefits[0].businessName, '로드힐 꽃작업실');
  }

  // wallet list auth boundary.
  {
    const bridge = createBenefitClaimBridge({ fetchImpl: async () => makeResponse(401, 'AUTH_REQUIRED') });
    const result = await bridge.listMine();
    assert.equal(result.mode, 'auth-required');
    assert.equal(result.benefits.length, 0);
  }
}

/* ---------------- inquiry-bridge ---------------- */
{
  const sandbox = makeSandbox(inquirySource);
  const { createInquiryBridge, businessIdFromKey, normalizeInquiry } = sandbox.DanjionInquiryBridge;
  assert.ok(createInquiryBridge);

  assert.equal(businessIdFromKey('api-' + BENEFIT_ID), BENEFIT_ID);
  assert.equal(businessIdFromKey('florist'), null);
  assert.equal(businessIdFromKey('api-not-a-uuid'), null);

  assert.equal(normalizeInquiry({ id: 'i1', inquiryType: 'shop_inquiry', title: '제목', body: '본문', status: 'received', response: null, createdAt: 'c', updatedAt: 'u' }).inquiryType, 'shop_inquiry');
  assert.equal(normalizeInquiry(null), null);

  // submit: canonical POST payload; shop name rides inside body (inquiries have no business lane).
  {
    let captured;
    const bridge = createInquiryBridge({
      apiBase: 'https://api.example.test/',
      complexSlug: COMPLEX_SLUG,
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return makeResponse(201, { id: 'i1', inquiryType: 'shop_inquiry', title: '토요일 예약 문의', body: '[로드힐 꽃작업실] 토요일 오후 예약 가능한가요?', status: 'received', response: null, answeredAt: null, closedAt: null, createdAt: 'c', updatedAt: 'u' });
      }
    });
    const result = await bridge.submit({ shopKey: 'api-' + BENEFIT_ID, shopName: '로드힐 꽃작업실', subject: '토요일 예약 문의', text: '토요일 오후 예약 가능한가요?' });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'server');
    assert.equal(result.status, 201);
    assert.equal(result.inquiry.status, 'received');
    assert.match(captured.url, /\/api\/v1\/me\/inquiries$/);
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.credentials, 'include');
    assert.deepEqual(JSON.parse(captured.init.body), {
      complexSlug: COMPLEX_SLUG,
      inquiryType: 'shop_inquiry',
      title: '토요일 예약 문의',
      body: '[로드힐 꽃작업실] 토요일 오후 예약 가능한가요?'
    });
  }

  // static/demo shop keys never call the authenticated inquiry API.
  {
    let called = false;
    const bridge = createInquiryBridge({ fetchImpl: async () => { called = true; } });
    const result = await bridge.submit({ shopKey: 'florist', shopName: '로드힐 꽃작업실', subject: '제목', text: '내용' });
    assert.equal(result.mode, 'static');
    assert.equal(result.error, 'SERVER_BUSINESS_ID_REQUIRED');
    assert.equal(called, false);
  }

  // empty fields fail closed client-side.
  {
    const bridge = createInquiryBridge({ fetchImpl: async () => { throw new Error('unexpected'); } });
    const result = await bridge.submit({ shopKey: 'api-' + BENEFIT_ID, shopName: '가게', subject: '   ', text: '내용' });
    assert.equal(result.mode, 'client');
    assert.equal(result.error, 'INQUIRY_FIELDS_REQUIRED');
  }

  // 401/403 are explicit auth boundaries.
  for (const status of [401, 403]) {
    const bridge = createInquiryBridge({ fetchImpl: async () => makeResponse(status, 'AUTH_REQUIRED') });
    const result = await bridge.submit({ shopKey: 'api-' + BENEFIT_ID, shopName: '가게', subject: '제목', text: '내용' });
    assert.equal(result.mode, 'auth-required');
    assert.equal(result.status, status);
  }

  // network failure fails closed.
  {
    const bridge = createInquiryBridge({ fetchImpl: async () => { throw new Error('offline'); } });
    const result = await bridge.submit({ shopKey: 'api-' + BENEFIT_ID, shopName: '가게', subject: '제목', text: '내용' });
    assert.equal(result.mode, 'error');
    assert.equal(result.status, 0);
    assert.equal(result.error, 'NETWORK_ERROR');
  }

  // listMine reads the {inquiries:[...]} envelope.
  {
    const bridge = createInquiryBridge({ fetchImpl: async () => makeResponse(200, { inquiries: [{ id: 'i1', inquiryType: 'shop_inquiry', title: '제목', body: '본문', status: 'received' }] }) });
    const result = await bridge.listMine();
    assert.equal(result.mode, 'server');
    assert.equal(result.inquiries.length, 1);
    assert.equal(result.inquiries[0].title, '제목');
  }
}

console.log('PASS stage5e benefit-claim + inquiry frontend bridge runtime (GAP-6/7)');
