import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #679 [QA P2 follow-up to #634]: our house (frontend/26_우리집연결.html)
// must present the SAME server snapshot that My Info (#488) already presents
// correctly. The same-session QA diagnostic (#634) proved both pages receive an
// identical household snapshot (myMembership.status=pending,
// residentVerified=false), so the remaining defect is presentation-only:
// renderHome() hardcoded '방림명지로드힐 · 우리집 연결 완료', which reads as
// "resident verification complete" for a pending resident.
//
// Two distinct meanings must stay distinct and never be merged:
//   household association      -> '우리집 연결됨'   (the household is linked)
//   resident verification      -> '주민인증 심사 대기 중' / '주민 확인됨'
//
// This contract asserts copy semantics only. It must never become a place where
// household_memberships status, residentVerified computation, the API contract,
// the auth/session layer, the DB schema, the QA fixture, or Production data is
// asserted or changed.
// Run: node frontend/tests/leaf-679-household-resident-state-copy-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f26 = await read('../26_우리집연결.html');
const f19 = await read('../19_내정보_메인.html');

const COMPLEX_PREFIX = '방림명지로드힐';
const ASSOCIATION_PENDING = '우리집 연결됨';
const ASSOCIATION_VERIFIED = '우리집 연결 완료';
const VERIFICATION_PENDING = '주민인증 심사 대기 중';
const VERIFICATION_VERIFIED = '주민 확인됨';

/* --- extract an inline function's exact source so it can be executed --- */
function extractFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} must be defined inline in 26_우리집연결.html`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const open = i;
  assert.ok(open > -1, `${name} must have a body`);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.equal(depth, 0, `${name} braces must balance`);
  return source.slice(start, i + 1);
}

const memberLabelSrc = extractFn(f26, 'memberLabel');
const renderHomeSrc = extractFn(f26, 'renderHome');

/* ================= 1. source-level copy contract ================= */
{
  // renderHome must drive the hero line from the server snapshot, not a literal.
  assert.ok(renderHomeSrc.includes('const me=snapshot.myMembership;'),
    'renderHome must read the server snapshot myMembership');
  assert.ok(!renderHomeSrc.includes(`textContent='${COMPLEX_PREFIX} · ${ASSOCIATION_VERIFIED}'`),
    'renderHome must never hardcode the resident-verified claim');
  assert.ok(renderHomeSrc.includes(`${COMPLEX_PREFIX} · \${residentState}`),
    'the hero line must interpolate the derived resident state');
  assert.ok(renderHomeSrc.includes("me.status==='verified'||me.residentVerified"),
    'the verified branch must key on status===verified OR residentVerified');
  assert.ok(renderHomeSrc.includes(ASSOCIATION_VERIFIED) && renderHomeSrc.includes(VERIFICATION_VERIFIED),
    'the verified copy pair must ship exactly');
  assert.ok(renderHomeSrc.includes(ASSOCIATION_PENDING) && renderHomeSrc.includes(VERIFICATION_PENDING),
    'the pending copy pair must ship exactly');

  // memberLabel(): pending must be explicit; verified copy is unchanged.
  assert.ok(memberLabelSrc.includes(VERIFICATION_VERIFIED), 'memberLabel keeps the verified copy');
  assert.ok(memberLabelSrc.includes(VERIFICATION_PENDING),
    'memberLabel pending copy must be 주민인증 심사 대기 중');
  assert.ok(!memberLabelSrc.includes("'확인 대기'"),
    'the vague 확인 대기 pending copy must be gone from memberLabel');

  // presentation-only: renderHome must introduce no new network surface.
  assert.ok(!/\/api\//.test(renderHomeSrc),
    'renderHome must stay presentation-only (no endpoint literal)');
  assert.ok(!renderHomeSrc.includes('localStorage') && !renderHomeSrc.includes('sessionStorage'),
    'resident state must never be persisted client-side');
}

/* ================= 2. page 19 must stay untouched ================= */
{
  assert.ok(f19.includes(`'${VERIFICATION_PENDING}'`), 'My Info (#488) pending copy must survive');
  assert.ok(f19.includes(`'주민인증 완료'`), 'My Info (#488) verified copy must survive');
  assert.ok(!f19.includes(`'${ASSOCIATION_PENDING}'`),
    'page 19 must not gain the page-26 household-association copy');
}

/* ================= 3. runtime contract (real renderHome) ================= */
function renderHome(snapshot) {
  const nodes = new Map();
  const created = [];
  const el = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, textContent: '', hidden: false, className: '', type: '',
        append() {}, addEventListener() {},
      });
    }
    return nodes.get(id);
  };
  const document = {
    createElement: (tag) => {
      const node = {
        tag, className: '', textContent: '', type: '',
        append() {}, addEventListener() {},
      };
      created.push(node);
      return node;
    },
  };
  const sandbox = { el, document, fmtDate: () => '2026-10-01', console };
  vm.createContext(sandbox);
  vm.runInContext(
    `${memberLabelSrc}\n${renderHomeSrc}\nglobalThis.__contract = { memberLabel, renderHome };`,
    sandbox,
  );
  sandbox.__contract.renderHome(snapshot);
  return { nodes, created, memberLabel: sandbox.__contract.memberLabel };
}

const snapshotFor = (me) => ({
  unit: { buildingCode: '102동', unitCode: '1802호' },
  myMembership: me,
  members: [
    me,
    { membershipId: 'peer-1', displayName: '세대원', membershipRole: 'member', residentVerified: false },
  ],
  invites: [],
});

/* --- 3A. the live QA state: household associated, resident verification pending --- */
{
  const me = { membershipId: 'me-1', displayName: '나', membershipRole: 'primary', status: 'pending', residentVerified: false };
  const { nodes, memberLabel } = renderHome(snapshotFor(me));
  const hero = nodes.get('household-home-complex').textContent;

  assert.equal(hero, `${COMPLEX_PREFIX} · ${ASSOCIATION_PENDING} · ${VERIFICATION_PENDING}`,
    'pending membership must present association and verification separately');
  assert.ok(!hero.includes(ASSOCIATION_VERIFIED),
    'pending must never read as 우리집 연결 완료 (verification complete)');
  assert.equal(nodes.get('household-my-role').textContent, `주 세대원 · ${VERIFICATION_PENDING}`,
    'my role row must carry the explicit pending verification copy');
  assert.equal(memberLabel({ membershipRole: 'member', residentVerified: false }),
    `세대원 · ${VERIFICATION_PENDING}`, 'peer pending member copy');
  assert.equal(nodes.get('household-home-panel').hidden, false, 'the household panel is revealed');
}

/* --- 3B. verified via status === 'verified' --- */
{
  const me = { membershipId: 'me-1', displayName: '나', membershipRole: 'primary', status: 'verified', residentVerified: true };
  const { nodes, memberLabel } = renderHome(snapshotFor(me));
  const hero = nodes.get('household-home-complex').textContent;

  assert.equal(hero, `${COMPLEX_PREFIX} · ${ASSOCIATION_VERIFIED} · ${VERIFICATION_VERIFIED}`,
    'verified membership presents the verified pair');
  assert.ok(!hero.includes(VERIFICATION_PENDING), 'verified must never show the pending copy');
  assert.equal(memberLabel({ membershipRole: 'member', residentVerified: true }),
    `세대원 · ${VERIFICATION_VERIFIED}`, 'verified member copy is unchanged');
}

/* --- 3C. residentVerified=true short-circuits to the verified branch --- */
{
  const me = { membershipId: 'me-1', displayName: '나', membershipRole: 'member', status: 'pending', residentVerified: true };
  const { nodes } = renderHome(snapshotFor(me));
  const hero = nodes.get('household-home-complex').textContent;

  assert.equal(hero, `${COMPLEX_PREFIX} · ${ASSOCIATION_VERIFIED} · ${VERIFICATION_VERIFIED}`,
    'residentVerified=true must resolve to the verified branch even while status is pending');
  assert.equal(nodes.get('household-my-role').textContent, `세대원 · ${VERIFICATION_VERIFIED}`,
    'role row follows residentVerified');
}

/* --- 3D. the two meanings stay merged-free in both directions --- */
{
  const pending = renderHome(snapshotFor({ membershipId: 'm', displayName: 'n', membershipRole: 'member', status: 'pending', residentVerified: false }))
    .nodes.get('household-home-complex').textContent;
  const verified = renderHome(snapshotFor({ membershipId: 'm', displayName: 'n', membershipRole: 'member', status: 'verified', residentVerified: true }))
    .nodes.get('household-home-complex').textContent;

  assert.ok(pending.includes(ASSOCIATION_PENDING) && pending.includes(VERIFICATION_PENDING),
    'pending carries association AND verification-pending');
  assert.ok(verified.includes(ASSOCIATION_VERIFIED) && verified.includes(VERIFICATION_VERIFIED),
    'verified carries association-complete AND verification-complete');
  assert.notEqual(pending, verified, 'the two server dispositions must not render identically');
}

console.log('OK: leaf-679-household-resident-state-copy-contract passed');
