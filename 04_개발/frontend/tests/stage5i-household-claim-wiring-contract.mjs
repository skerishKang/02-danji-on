import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const bridge = await import(new URL('frontend/assets/household-claim-bridge.js', root).href);
const sessionSource = await readFile(new URL('frontend/assets/danjion-session.js', root), 'utf8');
const pageSource = await readFile(new URL('frontend/26_우리집연결.html', root), 'utf8');

function loadRuntime() {
  const context = {
    globalThis: null,
    location: { search: '', origin: 'https://demo.example' },
    URLSearchParams
  };
  context.globalThis = context;
  vm.runInNewContext(sessionSource, context, { filename: 'danjion-session.js' });
  return context.DanjionSession;
}

const Session = loadRuntime();
const BASE = 'https://api.example.test';
const SLUG_PATH = '/api/v1/complexes/banglim-myeongji-roadhill/household';
const VALID_UNIT = '3f0c1a2b-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const VALID_TOKEN = 'aX9_-token-value-0123456789';
const INVITE_TOKEN = 'A'.repeat(64);

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

function makeBridge(responder) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return responder(calls.length - 1);
  };
  const b = bridge.createHouseholdClaimBridge({ apiBase: BASE, fetchImpl, Session });
  return { b, calls };
}

assert.equal(bridge.DANJION_HOUSEHOLD_COMPLEX_SLUG, 'banglim-myeongji-roadhill');

/* --- 1. claim: exact URL, body key set, credentials, normalized 201 --- */
{
  const { b, calls } = makeBridge(() => response(201, {
    data: { status: 'pending', membershipRole: 'primary', unitId: VALID_UNIT, alreadyVerified: false },
    requestId: 'r1'
  }));
  const result = await b.claim({ unitId: VALID_UNIT, token: VALID_TOKEN });
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}/claim`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(), ['token', 'unitId']);
  assert.equal(result.data.status, 'pending');
  assert.equal(result.data.alreadyVerified, false);
}

/* --- 2. claim guards: malformed unitId/token never reach the network --- */
{
  const { b, calls } = makeBridge(() => response(201, { data: {} }));
  const bad = [
    { unitId: 'not-a-uuid', token: VALID_TOKEN },
    { unitId: VALID_UNIT, token: 'short' },
    { unitId: '', token: VALID_TOKEN },
    { unitId: VALID_UNIT, token: 'has space 0123456789abc' }
  ];
  for (const input of bad) {
    const result = await b.claim(input);
    assert.equal(result.ok, false, `claim must reject ${JSON.stringify(input)}`);
    assert.equal(result.reason, 'validation-error');
    assert.equal(result.status, 0);
  }
  assert.equal(calls.length, 0, 'validation failures must not fetch');
}

/* --- 3. getSnapshot: URL, envelope extraction, normalization --- */
{
  const { b, calls } = makeBridge(() => response(200, {
    data: {
      complexSlug: 'banglim-myeongji-roadhill',
      unit: { buildingCode: '102', unitCode: '1802' },
      myMembership: { membershipId: VALID_UNIT, displayName: '나', membershipRole: 'primary', status: 'verified', residentVerified: true },
      members: [{ membershipId: VALID_UNIT, displayName: '나', membershipRole: 'primary', status: 'verified', residentVerified: true }],
      invites: [{ inviteId: VALID_UNIT, status: 'pending', createdAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-11T00:00:00Z' }]
    },
    requestId: 'r2'
  }));
  const result = await b.getSnapshot();
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(result.data.unit.buildingCode, '102');
  assert.equal(result.data.members.length, 1);
  assert.equal(result.data.invites[0].inviteId, VALID_UNIT);
}
{
  const { b } = makeBridge(() => response(200, { data: null, requestId: 'r3' }));
  const result = await b.getSnapshot();
  assert.equal(result.ok, true);
  assert.equal(result.data.unit, null);
  assert.deepEqual(result.data.members, []);
}

/* --- 4. createInvite: URL, body key set, TTL guard --- */
{
  const { b, calls } = makeBridge(() => response(201, {
    data: { inviteId: VALID_UNIT, token: INVITE_TOKEN, createdAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-11T00:00:00Z' },
    requestId: 'r4'
  }));
  const result = await b.createInvite(24);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}/family-invites`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ['expiresInHours']);
  assert.equal(result.data.token, INVITE_TOKEN);
}
{
  const { b, calls } = makeBridge(() => response(201, { data: {} }));
  for (const ttl of [0, 169, 1.5, NaN, '24']) {
    const result = await b.createInvite(ttl);
    assert.equal(result.ok, false, `TTL ${String(ttl)} must be rejected client-side`);
    assert.equal(result.reason, 'validation-error');
  }
  assert.equal(calls.length, 0);
}

/* --- 5. redeemInvite: slug-less canonical URL, token-only body, trim --- */
{
  const { b, calls } = makeBridge(() => response(201, {
    data: { membershipId: VALID_UNIT, membershipRole: 'member', status: 'pending', complexSlug: 'banglim-myeongji-roadhill', residentVerified: false, verificationRequired: true },
    requestId: 'r5'
  }));
  const result = await b.redeemInvite(`  ${INVITE_TOKEN}  `);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, `${BASE}/api/v1/household/family-invites/redeem`);
  assert.ok(!calls[0].url.includes('complexes'), 'redeem route must stay slug-less');
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ['token']);
  assert.equal(JSON.parse(calls[0].init.body).token, INVITE_TOKEN);
  assert.equal(result.data.residentVerified, false);
  assert.equal(result.data.verificationRequired, true);
}
{
  const { b, calls } = makeBridge(() => response(201, { data: {} }));
  const result = await b.redeemInvite('too-short');
  assert.equal(result.reason, 'validation-error');
  assert.equal(calls.length, 0);
}

/* --- 6. revokeInvite / revokeMember / leave: DELETE routes + UUID guards --- */
{
  const { b, calls } = makeBridge(() => response(204, null));
  const result = await b.revokeInvite(VALID_UNIT);
  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(result.data, null);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}/family-invites/${VALID_UNIT}`);
  assert.equal(calls[0].init.method, 'DELETE');
}
{
  const { b, calls } = makeBridge(() => response(204, null));
  await b.revokeMember(VALID_UNIT);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}/members/${VALID_UNIT}`);
  await b.leave();
  assert.equal(calls[1].url, `${BASE}${SLUG_PATH}/members/me`);
  assert.equal(calls[1].init.method, 'DELETE');
}
{
  const { b, calls } = makeBridge(() => response(204, null));
  const r1 = await b.revokeInvite('not-uuid');
  const r2 = await b.revokeMember('');
  assert.equal(r1.reason, 'validation-error');
  assert.equal(r2.reason, 'validation-error');
  assert.equal(calls.length, 0);
}

/* --- 7. listUnits: normalization drops invalid rows --- */
{
  const { b, calls } = makeBridge(() => response(200, {
    data: {
      complex: { slug: 'banglim-myeongji-roadhill', name: '방림명지로드힐' },
      units: [
        { id: VALID_UNIT, buildingCode: '102동', unitCode: '1802호' },
        { id: 'garbage', buildingCode: '103동', unitCode: '101호' }
      ]
    },
    requestId: 'r7'
  }));
  const result = await b.listUnits();
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, `${BASE}${SLUG_PATH}/units`);
  assert.equal(result.data.complex.name, '방림명지로드힐');
  assert.equal(result.data.units.length, 1);
  assert.equal(result.data.units[0].buildingCode, '102동');
}

/* --- 8. failure mapping via shared runtime: 401/403/500/network fail-closed --- */
{
  const codes = ['HOUSEHOLD_ASSOCIATION_REQUIRED', 'HOUSEHOLD_PRIMARY_REQUIRED', 'PRIMARY_HOUSEHOLD_ONLY', 'FAMILY_INVITE_UNAVAILABLE'];
  for (const code of codes) {
    const { b } = makeBridge(() => response(403, { error: { code, message: 'no' } }));
    const result = await b.getSnapshot();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'auth-required');
    assert.equal(result.error.code, code);
  }
}
{
  const { b } = makeBridge(() => response(409, { error: { code: 'HOUSEHOLD_CLAIM_UNAVAILABLE' } }));
  const result = await b.claim({ unitId: VALID_UNIT, token: VALID_TOKEN });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.error.code, 'HOUSEHOLD_CLAIM_UNAVAILABLE');
}
{
  const { b } = makeBridge(() => response(500, { error: { code: 'INTERNAL' } }));
  const result = await b.createInvite(24);
  assert.equal(result.reason, 'server-error');
}
{
  const { b } = makeBridge(() => { throw new Error('offline'); });
  const result = await b.getSnapshot();
  assert.equal(result.reason, 'network-error');
  assert.equal(result.status, 0);
}

/* --- 9. bridge requires runtime; no browser storage anywhere --- */
{
  assert.throws(
    () => bridge.createHouseholdClaimBridge({ apiBase: BASE, fetchImpl: async () => response(200, { data: null }), Session: undefined }),
    TypeError
  );
}
{
  const bridgeSource = await readFile(new URL('frontend/assets/household-claim-bridge.js', root), 'utf8');
  for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.ok(!bridgeSource.includes(banned), `bridge must never touch ${banned}`);
  }
}

/* --- 10. static page contract: 26_우리집연결.html wiring --- */
{
  const wiringStart = pageSource.indexOf('<script id="household-server-wiring-20260910">');
  assert.ok(wiringStart > -1, 'wiring script id must exist');
  const runtimeTag = pageSource.indexOf('<script src="assets/danjion-session.js"></script>');
  assert.ok(runtimeTag > -1 && runtimeTag < wiringStart, 'shared runtime must load before wiring');
  const wiring = pageSource.slice(wiringStart, pageSource.indexOf('</script>', wiringStart));
  assert.ok(wiring.includes("import('./assets/household-claim-bridge.js')"), 'wiring must load the bridge module');
  assert.ok(wiring.includes("get('apiBase')") && /if\s*\(!apiBase\)\s*return;/.test(wiring), 'wiring must early-return without apiBase');
  for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.ok(!wiring.includes(banned), `wiring must never persist via ${banned}`);
  }
  assert.ok(!/주민\s*확인\s*(서류|신청)/.test(wiring), 'no resident-verification UI promises (HOLD #59)');
  assert.ok(wiring.includes('가족 초대를 수락했습니다. 세대원 상태는 확인 대기이며 주민 권한은 아직 부여되지 않습니다.'), 'redeem copy must match V2 portal');
  for (const id of [
    'household-banner', 'household-home-panel', 'household-home-unit', 'household-home-complex',
    'household-member-count', 'household-my-role', 'household-leave', 'household-leave-row',
    'household-panels-row', 'household-members', 'household-invite-new', 'household-invite-copy',
    'household-invite-token', 'household-invite-expiry', 'household-share-kakao', 'household-share-sms',
    'household-share-native', 'household-invite-list', 'household-invite-primary-note',
    'household-claim-panel', 'household-claim-unit', 'household-claim-token', 'household-claim-submit',
    'household-claim-units', 'household-claim-complex', 'household-redeem-panel', 'household-redeem-token',
    'household-redeem-submit', 'household-redeem-note'
  ]) {
    assert.ok(pageSource.includes(`id="${id}"`), `markup must provide #${id}`);
  }
  const demoGuard = pageSource.indexOf('household-share-actions-20260904');
  assert.ok(demoGuard > -1, 'demo share IIFE must remain for demo mode');
  const demoBlock = pageSource.slice(demoGuard, pageSource.indexOf('</script>', demoGuard));
  assert.ok(/apiBase/.test(demoBlock), 'demo share IIFE must stand down when apiBase is present');
}

console.log('PASS #328 household claim wiring contract');
