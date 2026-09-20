import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');
const uuid = 'a0a1c4a1-1111-4111-8111-111111111111';
const locations = {
  custom: { hostname: 'danjion.padiem.net', origin: 'https://danjion.padiem.net', search: '' },
  pages: { hostname: 'danjion.pages.dev', origin: 'https://danjion.pages.dev', search: '' },
  local: { hostname: 'localhost', origin: 'http://localhost:4173', search: '' }
};

function response(status = 200, data = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => ({ data }) };
}

function fetchRecorder(calls, status = 200) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return response(status, { id: uuid, user: { id: uuid }, recommendations: [], benefits: [] });
  };
}

const sessionSource = await read('assets/danjion-session.js');
const communitySource = await read('assets/community-bridge.js');
const messagesSource = await read('assets/messages-notifications-bridge.js');
const savedSource = await read('assets/saved-shops-bridge.js');
const discovery = await read('01_이웃가게_발견.html');
const inquirySource = await read('assets/inquiry-bridge.js');
const benefitSource = await read('assets/benefit-claim-bridge.js');
const reviewsSource = await read('assets/reviews-bridge.js');
const { createApplicationReportBridge } = await import('../assets/application-report-bridge.js');

function bridgeRuntime() {
  const context = { location: locations.custom, URL, URLSearchParams, console, globalThis: null, fetch: undefined };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(inquirySource, context);
  vm.runInContext(benefitSource, context);
  vm.runInContext(reviewsSource, context);
  return context;
}

function runtime(location) {
  const context = { location, URL, URLSearchParams, console, globalThis: null };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sessionSource, context);
  vm.runInContext(communitySource, context);
  vm.runInContext(messagesSource, context);
  context.window = context;
  vm.runInContext(savedSource, context);
  return context;
}

for (const location of [locations.custom, locations.pages]) {
  const context = runtime(location);
  assert.equal(context.DanjionSession.danjionApiBase(), '', `${location.hostname} uses the relative base`);
  assert.equal(context.DanjionSession.isCanonicalProduction(), true);

  const communityCalls = [];
  const community = context.DanjionCommunityBridge.createCommunityBridge({
    apiBase: '', fetchImpl: fetchRecorder(communityCalls), location
  });
  const created = await community.createPost({ kind: 'question', title: '제목', body: '내용' });
  assert.equal(created.mode, 'server', `${location.hostname} community createPost is server-backed`);
  assert.equal(communityCalls.length, 1);
  assert.equal(communityCalls[0].url, '/api/v1/complexes/banglim-myeongji-roadhill/community/posts');
  assert.equal(communityCalls[0].init.method, 'POST');

  const messageCalls = [];
  const messages = context.DanjionMessagesNotificationsBridge.createMessagesNotificationsBridge({
    apiBase: '', fetchImpl: fetchRecorder(messageCalls), location
  });
  const conversations = await messages.listConversations();
  assert.equal(conversations.mode, 'server', `${location.hostname} messages are server-backed`);
  assert.equal(messageCalls[0].url, '/api/v1/me/conversations');

  const savedCalls = [];
  const storage = { getItem: () => null, setItem() {} };
  const saved = context.DanJionSavedShopsBridge.create({
    apiBase: '', fetchImpl: fetchRecorder(savedCalls), storage, location
  });
  const savedState = await saved.load();
  assert.equal(savedState.mode, 'server', `${location.hostname} saved shops are server-backed`);
  assert.equal(savedCalls[0].url, '/api/v1/me/bookmarks');
}

{
  const context = runtime(locations.local);
  const calls = [];
  const community = context.DanjionCommunityBridge.createCommunityBridge({ apiBase: '', fetchImpl: fetchRecorder(calls), location: locations.local });
  const result = await community.createPost({ kind: 'question', title: '제목', body: '내용' });
  assert.equal(result.error, 'SERVER_MODE_REQUIRED');
  assert.equal(calls.length, 0, 'local empty base stays fail-closed');
  const saved = context.DanJionSavedShopsBridge.create({ apiBase: '', fetchImpl: fetchRecorder(calls), storage: { getItem: () => null, setItem() {} }, location: locations.local });
  assert.equal((await saved.load()).mode, 'local');
  assert.equal(calls.length, 0);
}

assert.match(discovery, /const PRODUCTION_SERVER_MODE=Boolean\(CANONICAL_API_BASE\)\|\|DanjionSession\.isCanonicalProduction\(\)/);

const canonicalFetchCalls = [];
const bridgeOptions = { apiBase: '', fetchImpl: fetchRecorder(canonicalFetchCalls) };
const bridgeContext = bridgeRuntime();
assert.equal((await bridgeContext.DanjionReviewsBridge.createReviewsBridge({ ...bridgeOptions, complexSlug: 'banglim-myeongji-roadhill' }).list(`api-${uuid}`)).mode, 'server');
assert.equal((await bridgeContext.DanjionInquiryBridge.createInquiryBridge({ ...bridgeOptions, complexSlug: 'banglim-myeongji-roadhill' }).submit({ shopKey: `api-${uuid}`, subject: '문의', text: '내용' })).mode, 'server');
assert.equal((await bridgeContext.DanjionBenefitClaimBridge.createBenefitClaimBridge({ ...bridgeOptions, complexSlug: 'banglim-myeongji-roadhill' }).listMine()).mode, 'server');
assert.equal((await createApplicationReportBridge(bridgeOptions).listOwnerApplications()).ok, true);
assert.ok(canonicalFetchCalls.some(({ url }) => url.includes('/api/v1/complexes/banglim-myeongji-roadhill/businesses/')));
assert.ok(canonicalFetchCalls.some(({ url }) => url === 'https://danjion.padiem.net/api/v1/me/inquiries'));
assert.ok(canonicalFetchCalls.some(({ url }) => url === 'https://danjion.padiem.net/api/v1/me/benefits'));
assert.ok(canonicalFetchCalls.some(({ url }) => url === '/api/v1/me/business-applications'));

console.log('leaf-b830-canonical-empty-base-consumers-contract: PASS');
