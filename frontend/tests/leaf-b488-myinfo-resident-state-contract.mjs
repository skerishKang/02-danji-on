import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Issue #488 [Leaf B488]: My Info resident-verification state row + server-backed
// profile edit contract for frontend/19_내정보_메인.html.
// States come ONLY from server sources: household snapshot (verified/pending/
// association-required) via household-claim-bridge; the CTA appears only because
// 26_우리집연결.html is a real supported verification path; profile edits go only
// through PATCH /api/v1/me/profile and are applied only after a server 200.
// Run: node frontend/tests/leaf-b488-myinfo-resident-state-contract.mjs

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

const f19 = await read('../19_내정보_메인.html');
const residentJs = await read('../assets/resident-bridge.js');

const CANON = 'banglim-myeongji-roadhill';
const WRONG = 'bangnim-myeongji-roadhill';
assert.ok(!f19.includes(WRONG), 'f19 must not contain the typo slug');

const wiringStart = f19.indexOf('<script id="danjion-myinfo-server-wiring">');
assert.ok(wiringStart > -1, 'f19 must keep the myinfo server wiring script');
const wiring = f19.slice(wiringStart, f19.indexOf('</script>', wiringStart));

/* --- resident state row: truthful server-sourced states only --- */
assert.ok(f19.includes('id="mi-resident-row" hidden'), 'state row must exist and default to hidden (no fabricated state pre-load)');
assert.ok(f19.includes('id="mi-resident-state"'), 'state row must carry the state text node');
assert.ok(f19.includes('id="mi-resident-cta" href="26_우리집연결.html" hidden'), 'CTA must target the real household-claim page and stay hidden by default');
assert.ok(wiring.includes("'주민인증 완료'"), 'verified state copy');
assert.ok(wiring.includes("'주민인증 심사 대기 중'"), 'pending state copy (backend exposes pending membership status)');
assert.ok(wiring.includes("'주민인증 필요'"), 'not-verified state copy');
assert.ok(wiring.includes("result.error&&result.error.code==='HOUSEHOLD_ASSOCIATION_REQUIRED'"), 'not-verified must key on the server 403 code, never a guess');
assert.ok(wiring.includes('result.status===401'), '401 must be handled separately (logged-out is not a resident state)');
assert.ok(!/status===401[\s\S]{0,120}(주민인증 필요|renderResidentState\('[^']+\{kind:'required')/.test(wiring), '401 must not render the required state');
assert.ok(wiring.includes("import('./assets/household-claim-bridge.js')"), 'snapshot must come from the household-claim bridge module');
assert.ok(wiring.includes('.getSnapshot()'), 'state must read the household snapshot');
assert.ok(wiring.includes("renderResidentState('—',{kind:'unknown'})"), 'unexpected snapshot failures must fail closed to em-dash');
assert.ok(!wiring.includes('localStorage') && !f19.includes('localStorage'), 'no local persistence may fabricate resident state');

/* --- 내정보 수정 entry: visible only for verified residents, server-backed save --- */
assert.ok(f19.includes('id="mi-profile-edit" type="button" hidden'), 'edit entry must exist and default hidden');
assert.ok(f19.includes('>내정보 수정</button>'), 'edit entry copy');
assert.ok(f19.includes('id="mi-profile-edit-panel" hidden'), 'edit panel must exist and default hidden');
assert.ok(f19.includes('id="mi-edit-nickname" maxlength="40"'), 'nickname input mirrors the server 40-char bound');
assert.ok(f19.includes('id="mi-edit-bio" maxlength="300"'), 'bio textarea mirrors the server 300-char bound');
assert.ok(f19.includes('id="mi-edit-save"') && f19.includes('id="mi-edit-cancel"'), 'panel must carry save/cancel controls');
assert.ok(wiring.includes("flags&&flags.edit") && /renderResidentState\('주민인증 완료',\{kind:'verified',edit:true\}\)/.test(wiring), 'edit entry must be revealed only by a verified snapshot');
assert.ok(wiring.includes('bridge.updateProfile({nickname:nick.value,publicBio:bio.value})'), 'save must go through the bridge PATCH');
assert.ok(/updateProfile\(\{[\s\S]*?\.then\(function\(r\)\{[\s\S]*?if\(r&&r\.ok&&r\.profile\)\{[\s\S]*?serverProfile=r\.profile/.test(wiring),
  'save must apply server state only after a successful PATCH (no optimistic write)');
assert.ok(wiring.includes("mode==='resident-verification-required'"), 'PATCH 403 RESIDENT_VERIFICATION_REQUIRED must surface its own copy');
assert.ok(wiring.includes("mode==='auth-required'"), 'PATCH 401 must surface login copy');
assert.ok(wiring.includes("mode==='forbidden'"), 'PATCH generic 403 must surface forbidden copy');

/* --- router safety: new controls must not impersonate routed rows --- */
assert.ok(!/class="[^"]*card-link[^"]*"[^>]*id="mi-(resident|profile-edit|edit)/.test(f19), 'new controls must not use card-link');
assert.ok(!/class="[^"]*menu-row[^"]*"[^>]*id="mi-(resident|profile-edit|edit)/.test(f19), 'new controls must not use menu-row');

/* --- dedicated style block so the row never inherits demo-only chrome --- */
assert.ok(f19.includes('<style id="myinfo-resident-state-488">'), 'state row must ship its own scoped style block');

/* ================= updateProfile HTTP runtime contract (no DOM) ================= */
function loadBridge(source, apiBase) {
  const calls = [];
  let resp = { ok: true, status: 200, json: {} };
  const sandbox = {
    URLSearchParams,
    console,
    fetch: (url, init = {}) => {
      calls.push({ url: String(url), init });
      return Promise.resolve({ ok: resp.ok, status: resp.status, json: () => Promise.resolve(resp.json) });
    },
    location: { search: apiBase ? `?apiBase=${apiBase}` : '', origin: 'https://demo.test' },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { calls, setResp: (r) => { resp = r; }, resident: sandbox.DanjionResidentBridge };
}
const API = 'https://api.test';
const env = loadBridge(residentJs, API);
const bridge = env.resident.createResidentBridge({ apiBase: API });

env.setResp({ ok: true, status: 200, json: { data: { nickname: '새별이', publicBio: '안녕' } } });
const saved = await bridge.updateProfile({ nickname: '새별이', publicBio: '안녕' });
assert.equal(saved.ok, true, 'updateProfile success is ok');
assert.equal(saved.profile.nickname, '새별이', 'updateProfile returns the server profile');
assert.equal(env.calls.at(-1).init.method, 'PATCH', 'profile edit must PATCH');
assert.match(env.calls.at(-1).url, new RegExp(`/api/v1/me/profile\\?complexSlug=${CANON}$`), 'PATCH must target /api/v1/me/profile with the canonical slug');
assert.deepEqual(JSON.parse(env.calls.at(-1).init.body), { nickname: '새별이', publicBio: '안녕' }, 'PATCH body carries only whitelisted profile fields');

const empty = await bridge.updateProfile({});
assert.equal(empty.ok, false, 'empty patch is rejected client-side');
assert.equal(empty.error, 'PROFILE_PATCH_EMPTY', 'empty patch error code');
assert.ok(!env.calls.some((c) => c.init.method === 'PATCH' && c.init.body === '{}'), 'no network PATCH fires for an empty edit');

env.setResp({ ok: false, status: 403, json: { error: { code: 'RESIDENT_VERIFICATION_REQUIRED' } } });
const gated = await bridge.updateProfile({ nickname: 'x' });
assert.equal(gated.mode, 'resident-verification-required', 'PATCH 403 must not masquerade as login failure');

env.setResp({ ok: false, status: 401, json: { error: { code: 'AUTH_REQUIRED' } } });
const signedOut = await bridge.updateProfile({ nickname: 'x' });
assert.equal(signedOut.mode, 'auth-required', 'PATCH 401 maps to auth-required');

console.log('OK: leaf-b488-myinfo-resident-state-contract passed');
